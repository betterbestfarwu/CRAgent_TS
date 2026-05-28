import fs from "node:fs";
import path from "node:path";

const MAX_BOOTSTRAP_CHARS = 100_000;

const DEFAULT_SOUL = `# SOUL.md

You are CRAgent — a capable, concise coding assistant running on the user's Mac.

- Be direct and helpful; prefer actionable answers over filler.
- Ask clarifying questions when requirements are ambiguous.
- Respect safety: don't run destructive commands unless explicitly requested.
- You wake up fresh each session; your continuity is in workspace memory files.
`;

const DEFAULT_AGENTS = `# AGENTS.md

## Session start
- Bootstrap context from SOUL.md, USER.md, MEMORY.md, and today/yesterday \`memory/YYYY-MM-DD.md\` is injected automatically.
- Use \`memory_get\` to re-read any file; use \`memory_search\` to find notes.

## Memory (OpenClaw-style)
- **Daily log:** \`memory/YYYY-MM-DD.md\` — durable notes only (not raw chat or shell output).
- **Long-term:** \`MEMORY.md\` — curated facts, preferences, decisions.
- **Do NOT** write memory files for: shell commands (\`ls\`, \`pwd\`), one-off questions, or routine tool use.
- **Only** when the user explicitly asks you to remember/save something, describe what to remember and ask them to add it (memory files are not writable via \`write_file\`).
- Use \`memory_get\` / \`memory_search\` to read; never invent memory updates on your own.

## Tools
- Use \`bash\`, \`read_file\`, \`write_file\`, \`list_dir\` for code and files.
- **Skills** live in \`~/.CRAgent/skills/\` — catalog is in the system prompt; use \`load_skill\` for full instructions.
- Use \`download_skill\` / \`delete_skill\` to install or remove skills from a URL.
- Workspace root: \`~/.CRAgent\` (configurable via agents.default.workspace).

## Safety
- Don't dump directories or secrets into chat.
- Confirm before destructive or write-class operations when prompted.
`;

const DEFAULT_USER = `# USER.md

Fill in your details so the agent can personalize without re-asking every session.

- **Name:**
- **Timezone:**
- **Preferences:**
- **Active projects:**
`;

const DEFAULT_MEMORY = `# MEMORY.md

Curated long-term memory. Keep concise — bootstrap shares a ~100k character budget with other files.

## Facts

## Preferences

## Open loops
`;

function readFileIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    return fs.readFileSync(filePath, "utf-8");
}

function writeIfMissing(filePath, content) {
    if (!fs.existsSync(filePath)) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, "utf-8");
    }
}

function dayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

export class WorkspaceMemory {
    constructor(getWorkspace, memoryDir) {
        this.getWorkspace = getWorkspace;
        this.memoryDir = memoryDir;
    }

    bootstrapIfNeeded() {
        const root = this.getWorkspace();
        if (!fs.existsSync(this.memoryDir)) {
            fs.mkdirSync(this.memoryDir, { recursive: true });
        }
        writeIfMissing(path.join(root, "SOUL.md"), DEFAULT_SOUL);
        writeIfMissing(path.join(root, "AGENTS.md"), DEFAULT_AGENTS);
        writeIfMissing(path.join(root, "USER.md"), DEFAULT_USER);
        writeIfMissing(path.join(root, "MEMORY.md"), DEFAULT_MEMORY);
    }

    bootstrapSystemContent() {
        const root = this.getWorkspace();
        const sections = [];

        for (const name of ["SOUL.md", "AGENTS.md", "USER.md"]) {
            const body = readFileIfExists(path.join(root, name));
            if (body?.trim()) {
                sections.push({ path: name, body });
            }
        }

        const memory =
            readFileIfExists(path.join(root, "MEMORY.md")) ||
            readFileIfExists(path.join(root, "memory.md"));
        if (memory?.trim()) {
            sections.push({
                path: fs.existsSync(path.join(root, "MEMORY.md")) ? "MEMORY.md" : "memory.md",
                body: memory,
            });
        }

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        for (const day of [today, yesterday]) {
            const rel = `memory/${dayKey(day)}.md`;
            const body = readFileIfExists(path.join(root, rel));
            if (body?.trim()) {
                sections.push({ path: rel, body });
            }
        }

        if (!sections.length) {
            return null;
        }

        let out = `<workspace_bootstrap workspace="${root}">
You are a fresh instance each session; continuity lives in these workspace files.
Follow AGENTS.md procedures. Match SOUL.md tone. Personalize using USER.md.
Do not write to MEMORY.md or memory/*.md unless the user explicitly asks you to remember something. Never log shell commands or casual chat there.

`;
        let used = out.length;

        for (const { path: relPath, body } of sections) {
            const trimmed = body.trim();
            if (!trimmed) {
                continue;
            }
            let chunk = `<file path="${relPath}">\n${trimmed}\n</file>\n\n`;
            if (used + chunk.length > MAX_BOOTSTRAP_CHARS) {
                const remain = Math.max(0, MAX_BOOTSTRAP_CHARS - used - 80);
                if (remain > 200) {
                    chunk =
                        `<file path="${relPath}" truncated="true">\n` +
                        `${trimmed.slice(0, remain)}\n…</file>\n\n`;
                }
                out += chunk;
                out += `<!-- bootstrap truncated at ${MAX_BOOTSTRAP_CHARS} chars -->\n`;
                break;
            }
            out += chunk;
            used += chunk.length;
        }

        out += "</workspace_bootstrap>";
        return out;
    }

    resolveMemoryPath(relativePath) {
        const raw = String(relativePath || "").trim();
        if (!raw) {
            throw new Error("'path' is required");
        }
        const workspace = path.resolve(this.getWorkspace());
        const resolved = path.isAbsolute(raw)
            ? path.resolve(raw)
            : path.resolve(workspace, raw);
        const wsPath = workspace;
        if (resolved !== wsPath && !resolved.startsWith(`${wsPath}${path.sep}`)) {
            throw new Error("path must stay inside workspace");
        }
        if (!this.isAllowedMemoryPath(raw, resolved, workspace)) {
            throw new Error("path not allowed for memory tools");
        }
        return resolved;
    }

    isAllowedMemoryPath(relativePath, resolved, workspace) {
        const rel = relativePath.trim();
        const rootNames = new Set(["SOUL.md", "AGENTS.md", "USER.md", "MEMORY.md", "memory.md"]);
        if (rootNames.has(rel)) {
            return true;
        }
        if (rel.startsWith("memory/") || rel === "memory") {
            return resolved.startsWith(path.join(workspace, "memory"));
        }
        return false;
    }

    listSearchableMemoryFiles() {
        const workspace = this.getWorkspace();
        const files = [];
        for (const name of ["MEMORY.md", "memory.md"]) {
            const filePath = path.join(workspace, name);
            if (fs.existsSync(filePath)) {
                files.push(filePath);
            }
        }
        if (fs.existsSync(this.memoryDir)) {
            for (const entry of fs.readdirSync(this.memoryDir)) {
                if (entry.endsWith(".md")) {
                    files.push(path.join(this.memoryDir, entry));
                }
            }
        }
        return files;
    }
}
