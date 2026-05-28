import path from "node:path";

const ROOT_MEMORY_FILES = new Set(["SOUL.md", "AGENTS.md", "USER.md", "MEMORY.md", "memory.md"]);

/** Memory markdown files are not writable via generic write_file. */
export function assertWritableTarget(workspace, resolvedPath) {
    const rel = path.relative(path.resolve(workspace), resolvedPath).split(path.sep).join("/");
    if (ROOT_MEMORY_FILES.has(rel) || rel.startsWith("memory/")) {
        throw new Error(
            "Memory files (SOUL.md, AGENTS.md, USER.md, MEMORY.md, memory/*.md) cannot be changed with write_file. " +
                "Do not log chat messages, shell commands, or one-off requests there. " +
                "Only update memory when the user explicitly asks you to remember something durable.",
        );
    }
}
