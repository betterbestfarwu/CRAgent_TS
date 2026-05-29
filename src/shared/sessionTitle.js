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

const DEFAULT_SESSION_TITLES = new Set(["新对话", "新会话", "New Chat"]);

export function isDefaultSessionTitle(title) {
    const trimmed = String(title || "").trim();
    return !trimmed || DEFAULT_SESSION_TITLES.has(trimmed);
}

export function sessionHasUserMessages(messages) {
    return (messages || []).some((message) => message?.role === "user");
}

/** Pick the session to focus when opening「新建会话」— default sidebar title, prefer empty. */
export function pickPlaceholderSession(sessions) {
    const candidates = (sessions || []).filter((session) =>
        isDefaultSessionTitle(session?.meta?.title),
    );
    if (!candidates.length) {
        return null;
    }
    const withoutUser = candidates.filter((session) => !sessionHasUserMessages(session.messages));
    const pool = withoutUser.length ? withoutUser : candidates;
    pool.sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
    return pool[0];
}

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
