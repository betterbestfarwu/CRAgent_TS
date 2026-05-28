const SHELL_LIKE = new Set([
    "ls",
    "pwd",
    "cd",
    "cat",
    "echo",
    "whoami",
    "date",
    "clear",
    "help",
]);

/** Derive sidebar title from first user message; null = keep default title. */
export function titleFromFirstUserMessage(content) {
    const trimmed = String(content || "")
        .replace(/\n/g, " ")
        .trim();
    if (!trimmed) {
        return null;
    }
    const token = trimmed.split(/\s+/)[0]?.toLowerCase() || "";
    if (
        trimmed.length <= 16 &&
        !trimmed.includes(" ") &&
        /^[\w./-]+$/.test(trimmed) &&
        (SHELL_LIKE.has(token) || trimmed.length <= 3)
    ) {
        return null;
    }
    return trimmed.slice(0, 40);
}
