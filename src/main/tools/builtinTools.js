import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classifyBashCommand, resolveShellRuntime } from "../bashSafety.js";
import { classifyBashForPlanMode } from "../planMode.js";
import { describeShellInvocation } from "../shellRuntime.js";
import { shouldRequireBashConfirmation, shouldRequireNetworkConfirmation } from "../authPolicy.js";
import { assertWritableTarget } from "@shared/memoryPaths.js";
import {
    goalModeBashBlocksWorkspaceCragent,
    isPathUnderWorkspaceCragent,
    resolveSessionStorageToolPath,
} from "@shared/sessionStoragePaths.js";
import { resolveCwd, resolvePathInWorkspace } from "../workspacePaths.js";
import { resolveSkillName } from "../skillLoader.js";
import { truncateShellOutput } from "../shellOutputLimits.js";
import { DEFAULT_MAX_RESULT_SIZE_CHARS } from "@shared/toolLimits.js";

const execFileAsync = promisify(execFile);

function resolveToolFilePath(workspace, rawPath, context) {
    const sessionId = context?.sessionId;
    const sessionsDir = context?.sessionsDir;
    if (sessionsDir && sessionId) {
        const redirected = resolveSessionStorageToolPath(rawPath, {
            workspace,
            sessionsDir,
            sessionId,
            planFilePath: context?.planFilePath,
        });
        if (redirected) {
            return redirected;
        }
    }
    const resolved = resolvePathInWorkspace(workspace, rawPath);
    if (
        context?.executionMode === "goal" &&
        workspace &&
        isPathUnderWorkspaceCragent(workspace, resolved)
    ) {
        throw new Error(
            "不要向工作区 .cragent 写入。请使用 write_file，路径使用 plan.md 或相对会话目录的文件名。",
        );
    }
    return resolved;
}

function fnSchema(name, description, parameters) {
    return {
        type: "function",
        function: { name, description, parameters },
    };
}

async function runShell(command, cwd, runtime) {
    const startedAt = Date.now();
    const timeoutMs = 60_000;
    const execArgs = [...runtime.argsPrefix, command];
    try {
        const { stdout, stderr } = await execFileAsync(runtime.executable, execArgs, {
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
        return truncateShellOutput(text);
    }
}

export function createBuiltinTools({
    getAgentWorkspace,
    getDefaultWorkspace,
    workspaceMemory,
    skillLoader,
    getAgentTools,
    confirmToolExecution,
    getAuthMode = () => "default",
    getShellRuntime = resolveShellRuntime,
}) {
    let shellRuntime;
    try {
        shellRuntime = getShellRuntime();
    } catch {
        shellRuntime = null;
    }

    const tools = [
        {
            name: "read_file",
            maxResultSizeChars: Infinity,
            requiresConfirmation: false,
            enabled: () => getAgentTools().enable_file_tools !== false,
            schema: fnSchema(
                "read_file",
                "Read a UTF-8 text file in the agent workspace. Returns the file contents, optionally truncated to max_bytes.",
                {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Workspace-relative path, or an absolute path contained in the workspace",
                    },
                    max_bytes: {
                        type: "integer",
                        description: "Optional byte cap for the returned text; defaults to 200000",
                    },
                },
                required: ["path"],
                },
            ),
            async execute(args, context) {
                const workspace = getAgentWorkspace(context?.sessionId);
                const filePath = resolveToolFilePath(workspace, args.path, context);
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
            maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
            requiresConfirmation: true,
            enabled: () => getAgentTools().enable_file_tools !== false,
            schema: fnSchema(
                "write_file",
                "Create or overwrite a UTF-8 text file. Use it for text-only files; plan.md and .cragent/... paths are redirected to the session storage directory (~/.CRAgent/sessions/<sessionsRootGuid>/<sessionId>/ or ~/.CRAgent/sessions/<projectsRootGuid>/<projectId>/<sessionId>/).",
                {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description:
                            "Workspace-relative path, or a session file path such as plan.md or .cragent/...",
                    },
                    content: {
                        type: "string",
                        description: "Full file contents to write",
                    },
                },
                required: ["path", "content"],
                },
            ),
            async execute(args, context) {
                const workspace = getAgentWorkspace(context?.sessionId);
                const filePath = resolveToolFilePath(workspace, args.path, context);
                assertWritableTarget(workspace, filePath);
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await fs.writeFile(filePath, String(args.content ?? ""), "utf-8");
                return `Wrote ${String(args.content ?? "").length} bytes to ${filePath}`;
            },
        },
        {
            name: "list_dir",
            maxResultSizeChars: 20_000,
            requiresConfirmation: false,
            enabled: () => getAgentTools().enable_file_tools !== false,
            schema: fnSchema("list_dir", "List entries in a workspace directory and return one name per line.", {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Directory relative to the workspace root; defaults to the workspace root",
                    },
                },
            }),
            async execute(args, context) {
                const workspace = getAgentWorkspace(context?.sessionId);
                let dirPath = workspace;
                if (args.path) {
                    const redirected = resolveSessionStorageToolPath(args.path, {
                        workspace,
                        sessionsDir: context?.sessionsDir,
                        sessionId: context?.sessionId,
                        planFilePath: context?.planFilePath,
                    });
                    dirPath = redirected || resolvePathInWorkspace(workspace, args.path);
                }
                const items = await fs.readdir(dirPath);
                return items.join("\n");
            },
        },
        {
            name: "bash",
            maxResultSizeChars: 30_000,
            requiresConfirmation: false,
            enabled: () => getAgentTools().enable_tools !== false,
            schema: fnSchema(
                "bash",
                shellRuntime
                    ? `Run one shell command via ${describeShellInvocation(shellRuntime)}. Use for shell-only tasks that file tools cannot express. Defaults to the agent workspace (~/.CRAgent).`
                    : "Run one shell command in the agent workspace (~/.CRAgent). Use for shell-only tasks that file tools cannot express.",
                {
                    type: "object",
                    properties: {
                        command: {
                            type: "string",
                            description: "Single shell command line to run",
                        },
                        cwd: {
                            type: "string",
                            description: "Working directory for the command; defaults to the workspace root",
                        },
                    },
                    required: ["command"],
                },
            ),
            async execute(args, context) {
                const command = String(args.command || "").trim();
                if (!command) {
                    throw new Error("'command' is required");
                }
                if (!shellRuntime) {
                    throw new Error("No supported shell found on this system");
                }
                const workspace = getAgentWorkspace(context?.sessionId);
                const cwd = resolveCwd(workspace, args.cwd);
                if (context?.executionMode === "goal") {
                    const cragentBlock = goalModeBashBlocksWorkspaceCragent(command);
                    if (cragentBlock) {
                        throw new Error(cragentBlock);
                    }
                }
                const safety =
                    context?.executionMode === "plan"
                        ? classifyBashForPlanMode(command, shellRuntime, { workspace })
                        : classifyBashCommand(command, shellRuntime, { workspace });
                if (safety.kind === "blocked") {
                    throw new Error(safety.reason);
                }
                if (shouldRequireBashConfirmation(safety, () => getAuthMode(context?.sessionId))) {
                    const approved = await confirmToolExecution(
                        "bash",
                        `[${shellRuntime.label}]\n$ ${command}\n(cwd: ${cwd})\n\n${safety.reason}`,
                    );
                    if (!approved) {
                        throw new Error(`user declined: ${safety.reason}`);
                    }
                }
                return runShell(command, cwd, shellRuntime);
            },
        },
        {
            name: "web_fetch",
            maxResultSizeChars: 8000,
            requiresConfirmation: false,
            enabled: () => getAgentTools().enable_tools !== false,
            schema: fnSchema("web_fetch", "Fetch the raw text/HTML content of an HTTP(S) URL.", {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "HTTP(S) URL to fetch",
                    },
                },
                required: ["url"],
            }),
            async execute(args, context) {
                const url = String(args.url || "");
                if (shouldRequireNetworkConfirmation(() => getAuthMode(context?.sessionId))) {
                    const approved = await confirmToolExecution(
                        "web_fetch",
                        `访问网络 URL:\n${url}`,
                    );
                    if (!approved) {
                        throw new Error("user declined: web_fetch");
                    }
                }
                const response = await fetch(url);
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
                "Read one workspace memory file: SOUL.md, AGENTS.md, USER.md, MEMORY.md, memory.md, or memory/YYYY-MM-DD.md.",
                {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Examples: MEMORY.md, SOUL.md, memory/2026-05-27.md",
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
                "Search MEMORY.md and memory/*.md with a JavaScript regular expression.",
                {
                    type: "object",
                    properties: {
                        pattern: { type: "string", description: "JavaScript RegExp pattern" },
                        case_insensitive: { type: "boolean", description: "If true, add the i flag" },
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
                const workspace = getDefaultWorkspace();
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
                "Load the full body of an installed skill by exact name. Use it when the task clearly matches a known skill.",
                {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Exact skill name to load" },
                        url: {
                            type: "string",
                            description: "Optional source URL used to derive the skill name if name is omitted",
                        },
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
                "Download and install a skill from a URL into ~/.CRAgent/skills/<name>/SKILL.md.",
                {
                    type: "object",
                    properties: {
                        url: { type: "string", description: "HTTP(S) URL of the skill source" },
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
                "Delete an installed skill directory from ~/.CRAgent/skills/.",
                {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Exact installed skill name" },
                        url: {
                            type: "string",
                            description: "Optional source URL used to derive the skill name if name is omitted",
                        },
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
