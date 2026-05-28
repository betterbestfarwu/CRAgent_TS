import fs from "node:fs";
import path from "node:path";

const BUILTIN_SKILLS = {
    "git-commit-helper": {
        content: `---
name: git-commit-helper
description: Generate Conventional Commit messages from staged diff. Use when the user asks for a commit message.
---

# Git Commit Helper

Procedure:
1. Run \`git status --short\` and \`git diff --cached\` via the \`bash\` tool to inspect changes.
2. Classify each change: feat / fix / refactor / docs / test / chore.
3. Draft a 1-line subject (<= 72 chars) and an optional body explaining the *why*.
4. Output ONE commit message block in fenced code only — do not run \`git commit\` yourself.
`,
    },
    "code-reviewer": {
        content: `---
name: code-reviewer
description: Perform a focused code review on a file or diff. Use when the user asks for review or critique of code.
---

# Code Reviewer

For each file the user supplies (path) or the staged diff:
1. Read the file with \`read_file\`.
2. List concrete issues in this order: correctness > security > performance > style.
3. Suggest the smallest patch that fixes each issue.
4. Be specific: cite line numbers and quote the offending snippet.
`,
    },
};

function stripQuotes(value) {
    let v = value.trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
        return v.slice(1, -1);
    }
    return v;
}

function parseFrontmatter(text) {
    const lines = text.split("\n");
    if (lines[0]?.trim() !== "---") {
        return { fields: {}, body: text };
    }
    const fields = {};
    let idx = 1;
    while (idx < lines.length) {
        const line = lines[idx];
        if (line.trim() === "---") {
            idx += 1;
            break;
        }
        const colon = line.indexOf(":");
        if (colon >= 0) {
            const key = line.slice(0, colon).trim();
            const value = stripQuotes(line.slice(colon + 1));
            fields[key] = value;
        }
        idx += 1;
    }
    return { fields, body: lines.slice(idx).join("\n") };
}

export function normalizeSkillName(raw) {
    let s = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/_/g, "-");
    if (!s) {
        return null;
    }
    let out = "";
    for (const ch of s) {
        if (/[a-z0-9-]/.test(ch)) {
            out += ch;
        } else {
            out += "-";
        }
    }
    while (out.includes("--")) {
        out = out.replace("--", "-");
    }
    out = out.replace(/^-+|-+$/g, "");
    return out || null;
}

export function deriveSkillName(urlString) {
    try {
        const url = new URL(urlString);
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.at(-1)?.toLowerCase() === "skill.md" && parts.length >= 2) {
            return normalizeSkillName(parts.at(-2));
        }
        if (parts.length) {
            const last = parts.at(-1);
            return normalizeSkillName(last.replace(/\.[^.]+$/, ""));
        }
    } catch {
        return null;
    }
    return null;
}

export function resolveSkillName(name, url) {
    const normalized = normalizeSkillName(name);
    if (normalized) {
        return normalized;
    }
    const fromUrl = url ? deriveSkillName(url) : null;
    if (fromUrl) {
        return fromUrl;
    }
    throw new Error("skill 'name' or derivable 'url' is required");
}

export class SkillLoader {
    constructor(skillsDir) {
        this.skillsDir = skillsDir;
        this.skills = [];
        this.byName = new Map();
    }

    bootstrapIfNeeded() {
        if (!fs.existsSync(this.skillsDir)) {
            fs.mkdirSync(this.skillsDir, { recursive: true });
        }
        const entries = fs.existsSync(this.skillsDir) ? fs.readdirSync(this.skillsDir) : [];
        if (!entries.length) {
            for (const [folder, { content }] of Object.entries(BUILTIN_SKILLS)) {
                const dir = path.join(this.skillsDir, folder);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf-8");
            }
        }
        this.reload();
    }

    reload() {
        this.skills = this.scan(this.skillsDir);
        this.byName = new Map(this.skills.map((skill) => [skill.name, skill]));
    }

    describeAvailable() {
        if (!this.skills.length) {
            return "(no skills available)";
        }
        return this.skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
    }

    loadFullText(name) {
        const key = String(name || "").trim();
        const skill = this.byName.get(key);
        if (!skill) {
            const known = this.skills.map((s) => s.name).join(", ");
            return `Error: Unknown skill '${key}'. Available skills: ${known || "(none)"}`;
        }
        return `<skill name="${skill.name}">\n${skill.body}\n</skill>`;
    }

    systemPromptSection() {
        if (!this.skills.length) {
            return `## Available Skills
Use load_skill when a task needs specialized instructions before you act.
Use download_skill to install skills from a URL into ${this.skillsDir}.

# Skills available:
(no skills installed yet)`;
        }
        return `## Available Skills
Use load_skill when a task needs specialized instructions before you act.
Use download_skill to install skills from a URL; use delete_skill to remove one.

# Skills available:
${this.describeAvailable()}

Skills directory: ${this.skillsDir}`;
    }

    installDirectory(skillName) {
        const normalized = normalizeSkillName(skillName);
        if (!normalized) {
            throw new Error("invalid skill name");
        }
        const root = path.resolve(this.skillsDir);
        const dir = path.resolve(root, normalized);
        if (dir !== root && !dir.startsWith(`${root}${path.sep}`)) {
            throw new Error("skill path escapes skills directory");
        }
        return dir;
    }

    deleteSkill(name) {
        const dir = this.installDirectory(name);
        if (!fs.existsSync(dir)) {
            return `Skill '${name}' is not installed.`;
        }
        fs.rmSync(dir, { recursive: true, force: true });
        this.reload();
        return `Deleted skill '${name}' from '${dir}'.`;
    }

    async downloadSkill(name, url) {
        const urlString = String(url || "").trim();
        if (!urlString || !/^https?:\/\//i.test(urlString)) {
            throw new Error("'url' must be http(s)");
        }
        const skillName = resolveSkillName(name, urlString);
        const installDir = this.installDirectory(skillName);
        const skillFile = path.join(installDir, "SKILL.md");
        if (fs.existsSync(skillFile)) {
            return `Skill '${skillName}' is already installed at '${installDir}'.`;
        }
        fs.mkdirSync(installDir, { recursive: true });
        const response = await fetch(urlString, {
            headers: { "User-Agent": "CRAgent/1.0" },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} fetching skill`);
        }
        const text = await response.text();
        if (!text.trim()) {
            fs.rmSync(installDir, { recursive: true, force: true });
            throw new Error("download returned empty content");
        }
        const nonPrintable = [...text.slice(0, 4096)].filter((ch) => {
            const code = ch.charCodeAt(0);
            return code < 9 || (code > 13 && code < 32);
        }).length;
        if (nonPrintable / Math.max(text.slice(0, 4096).length, 1) > 0.05) {
            fs.rmSync(installDir, { recursive: true, force: true });
            throw new Error("downloaded content is not valid UTF-8 text");
        }
        fs.writeFileSync(skillFile, text, "utf-8");
        this.reload();
        return `Installed skill '${skillName}' from '${urlString}' to '${installDir}'.`;
    }

    scan(root) {
        if (!fs.existsSync(root)) {
            return [];
        }
        const out = [];
        const seen = new Set();
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name.startsWith(".")) {
                    continue;
                }
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                    continue;
                }
                if (entry.name !== "SKILL.md") {
                    continue;
                }
                const raw = fs.readFileSync(full, "utf-8");
                const parsed = parseFrontmatter(raw);
                const folderName = path.basename(path.dirname(full));
                const skillName = parsed.fields.name || folderName;
                if (seen.has(skillName)) {
                    continue;
                }
                seen.add(skillName);
                out.push({
                    name: skillName,
                    description: parsed.fields.description || "",
                    path: full,
                    body: parsed.body,
                });
            }
        };
        walk(root);
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }
}
