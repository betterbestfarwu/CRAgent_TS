import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classifyBashCommand } from "../bashSafety.js";
import { assertWritableTarget } from "@shared/memoryPaths.js";
import { resolveCwd, resolvePathInWorkspace } from "../workspacePaths.js";
import { resolveSkillName } from "../skillLoader.js";

const execFileAsync = promisify(execFile);

function fnSchema(name, description, parameters) {
    return {
        type: "function",
        function: { name, description, parameters },
    };
}

async function runBash(command, cwd) {
    const startedAt = Date.now();
    const timeoutMs = 60_000;
    try {
        const { stdout, stderr } = await execFileAsync("/bin/zsh", ["-c", command], {
            cwd,
            maxBuffer: 4 * 1024 * 1024,
            timeout: timeoutMs,
            encoding: "utf-8",
        });
        const out = String(stdout || "");
        const err = String(stderr || "");
        let text = `exit=0\n--- stdout ---\n${out}`;
        if (err) {
            text += `\n--- stderr ---\n${err}`;
        }
        return text;
    } catch (error) {
        const stdout = error.stdout ? String(error.stdout) : "";
        const stderr = error.stderr ? String(error.stderr) : "";
        const status = error.code ?? 1;
        let text = `exit=${status}\n--- stdout ---\n${stdout}`;
        if (stderr) {
            text += `\n--- stderr ---\n${stderr}`;
        }
        if (Date.now() - startedAt >= timeoutMs) {
            text += "\n--- stderr ---\n(command timed out after 60s)";
        }
        return text;
    }
}

export function createBuiltinTools({
    getWorkspace,
    workspaceMemory,
    skillLoader,
    getAgentTools,
    confirmToolExecution,
}) {
    const tools = [
        {
            name: "read_file",
            requiresConfirmation: false,
            enabled: () => getAgentTools().enable_file_tools !== false,
            schema: fnSchema("read_file", "Read a UTF-8 text file inside the agent workspace.", {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path relative to workspace or absolute under workspace" },
                    max_bytes: { type: "integer", description: "Optional cap; defaults to 200000" },
                },
                required: ["path"],
            }),
            async execute(args) {
                const workspace = getWorkspace();
                const filePath = resolvePathInWorkspace(workspace, args.path);
                if (!fsSync.existsSync(filePath)) {
                    throw new Error(`file not found: ${filePath}`);
                }
                const cap = Number(args.max_bytes) > 0 ? Number(args.max_bytes) : 200_000;
                const data = fsSync.readFileSync(filePath).subarray(0, cap);
                const text = data.toString("utf-8");
                let header = `<file path="${filePath}" bytes=${data.length}`;
                if (data.length >= cap) {
                    header += ' truncated="true"';
                }
                return `${header}>\n${text}\n</file>`;
            },
        },
        {
            name: "write_file",
            requiresConfirmation: true,
            enabled: () => getAgentTools().enable_file_tools !== false,
            schema: fnSchema("write_file", "Create or overwrite a UTF-8 text file inside the workspace.", {
                type: "object",
                properties: {
                    path: { type: "string" },
                    content: { type: "string" },
                },
                required: ["path", "content"],
            }),
            async execute(args) {
                const workspace = getWorkspace();
                const filePath = resolvePathInWorkspace(workspace, args.path);
                assertWritableTarget(workspace, filePath);
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await fs.writeFile(filePath, String(args.content ?? ""), "utf-8");
                return `Wrote ${String(args.content ?? "").length} bytes to ${filePath}`;
            },
        },
        {
            name: "list_dir",
            requiresConfirmation: false,
            enabled: () => getAgentTools().enable_file_tools !== false,
            schema: fnSchema("list_dir", "List files in a workspace directory.", {
                type: "object",
                properties: {
                    path: { type: "string", description: "Directory relative to workspace; defaults to workspace root" },
                },
            }),
            async execute(args) {
                const workspace = getWorkspace();
                const dirPath = args.path
                    ? resolvePathInWorkspace(workspace, args.path)
                    : workspace;
                const items = await fs.readdir(dirPath);
                return items.join("\n");
            },
        },
        {
            name: "bash",
            requiresConfirmation: false,
            enabled: () => getAgentTools().enable_tools !== false,
            schema: fnSchema(
                "bash",
                "Run a shell command via /bin/zsh -c. Defaults to the agent workspace (~/.CRAgent).",
                {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "Shell command line" },
                        cwd: { type: "string", description: "Working directory (defaults to workspace)" },
                    },
                    required: ["command"],
                },
            ),
            async execute(args) {
                const command = String(args.command || "").trim();
                if (!command) {
                    throw new Error("'command' is required");
                }
                const workspace = getWorkspace();
                const cwd = resolveCwd(workspace, args.cwd);
                const safety = classifyBashCommand(command);
                if (safety.kind === "blocked") {
                    throw new Error(safety.reason);
                }
                if (safety.kind === "needsConfirmation") {
                    const approved = await confirmToolExecution(
                        "bash",
                        `$ ${command}\n(cwd: ${cwd})\n\n${safety.reason}`,
                    );
                    if (!approved) {
                        throw new Error(`user declined: ${safety.reason}`);
                    }
                }
                return runBash(command, cwd);
            },
        },
        {
            name: "web_fetch",
            requiresConfirmation: false,
            enabled: () => getAgentTools().enable_tools !== false,
            schema: fnSchema("web_fetch", "Fetch webpage content by URL", {
                type: "object",
                properties: { url: { type: "string" } },
                required: ["url"],
            }),
            async execute(args) {
                const response = await fetch(String(args.url || ""));
                const text = await response.text();
                return text.slice(0, 8000);
            },
        },
        {
            name: "memory_get",
            requiresConfirmation: false,
            enabled: () => getAgentTools().enable_tools !== false,
            schema: fnSchema(
                "memory_get",
                "Read a workspace memory file (SOUL.md, AGENTS.md, USER.md, MEMORY.md, or memory/YYYY-MM-DD.md).",
                {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "e.g. MEMORY.md, SOUL.md, memory/2026-05-27.md",
                        },
                    },
                    required: ["path"],
                },
            ),
            async execute(args) {
                const filePath = workspaceMemory.resolveMemoryPath(args.path);
                if (!fsSync.existsSync(filePath)) {
                    throw new Error(`file not found: ${args.path}`);
                }
                const text = await fs.readFile(filePath, "utf-8");
                return `<memory_file path="${args.path}">\n${text}\n</memory_file>`;
            },
        },
        {
            name: "memory_search",
            requiresConfirmation: false,
            enabled: () => getAgentTools().enable_tools !== false,
            schema: fnSchema(
                "memory_search",
                "Search MEMORY.md and memory/*.md for a regex pattern.",
                {
                    type: "object",
                    properties: {
                        pattern: { type: "string", description: "Regex pattern" },
                        case_insensitive: { type: "boolean", description: "Default false" },
                    },
                    required: ["pattern"],
                },
            ),
            async execute(args) {
                const pattern = String(args.pattern || "");
                if (!pattern) {
                    throw new Error("'pattern' is required");
                }
                const flags = args.case_insensitive ? "i" : "";
                const regex = new RegExp(pattern, flags);
                const cap = 80;
                const workspace = getWorkspace();
                const matches = [];
                for (const filePath of workspaceMemory.listSearchableMemoryFiles()) {
                    const rel = filePath.startsWith(`${workspace}${path.sep}`)
                        ? filePath.slice(workspace.length + 1)
                        : path.basename(filePath);
                    const lines = (await fs.readFile(filePath, "utf-8")).split("\n");
                    for (let i = 0; i < lines.length; i += 1) {
                        if (regex.test(lines[i])) {
                            matches.push(`${rel}:${i + 1}: ${lines[i]}`);
                            if (matches.length >= cap) {
                                break;
                            }
                        }
                    }
                    if (matches.length >= cap) {
                        break;
                    }
                }
                if (!matches.length) {
                    return `No matches for pattern: ${pattern}`;
                }
                let out = `memory_search (${Math.min(matches.length, cap)} matches):\n`;
                out += matches.slice(0, cap).join("\n");
                if (matches.length >= cap) {
                    out += "\n…(truncated)";
                }
                return out;
            },
        },
        {
            name: "load_skill",
            requiresConfirmation: false,
            enabled: () => getAgentTools().enable_skills !== false,
            schema: fnSchema(
                "load_skill",
                "Load the full body of a named skill. See system prompt for the skill catalog.",
                {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Skill name to load" },
                        url: { type: "string", description: "Optional; used to derive name if name is omitted" },
                    },
                },
            ),
            async execute(args) {
                const skillName = resolveSkillName(args.name, args.url);
                return skillLoader.loadFullText(skillName);
            },
        },
        {
            name: "download_skill",
            requiresConfirmation: true,
            enabled: () => getAgentTools().enable_skills !== false,
            schema: fnSchema(
                "download_skill",
                "Download and install a skill from a URL into ~/.CRAgent/skills/<name>/SKILL.md",
                {
                    type: "object",
                    properties: {
                        url: { type: "string", description: "Skill source URL" },
                        name: { type: "string", description: "Optional local skill name" },
                    },
                    required: ["url"],
                },
            ),
            async execute(args) {
                return skillLoader.downloadSkill(args.name, args.url);
            },
        },
        {
            name: "delete_skill",
            requiresConfirmation: true,
            enabled: () => getAgentTools().enable_skills !== false,
            schema: fnSchema(
                "delete_skill",
                "Delete an installed skill directory from ~/.CRAgent/skills/",
                {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Installed skill name" },
                        url: { type: "string", description: "Optional; used to derive name if name is omitted" },
                    },
                },
            ),
            async execute(args) {
                const skillName = resolveSkillName(args.name, args.url);
                return skillLoader.deleteSkill(skillName);
            },
        },
    ];

    return tools;
}

