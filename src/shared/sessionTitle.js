const DEFAULT_SESSION_TITLES = new Set(["新对话", "新会话", "New Chat"]);

export function isDefaultSessionTitle(title) {
    const trimmed = String(title || "").trim();
    return !trimmed || DEFAULT_SESSION_TITLES.has(trimmed);
}

export function sessionHasUserMessages(messages) {
    return (messages || []).some((message) => message?.role === "user");
}

/** Pick the session to focus when opening「新建会话」— only empty default-title sessions. */
export function pickPlaceholderSession(sessions) {
    const candidates = (sessions || []).filter((session) =>
        isDefaultSessionTitle(session?.meta?.title),
    );
    const withoutUser = candidates.filter((session) => {
        if (typeof session.meta?.hasUserMessages === "boolean") {
            return !session.meta.hasUserMessages;
        }
        return !sessionHasUserMessages(session.messages);
    });
    if (!withoutUser.length) {
        return null;
    }
    withoutUser.sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
    return withoutUser[0];
}

/** Derive sidebar title from first user message; null = keep default title. */
export function titleFromFirstUserMessage(content) {
    const trimmed = String(content || "")
        .replace(/\n/g, " ")
        .trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.slice(0, 40);
}

export function titleFromAssistantReply(content) {
    const trimmed = String(content || "").trim();
    if (!trimmed) {
        return null;
    }
    const firstSentence = trimmed.split(/[\r\n。！？.!?]+/u)[0]?.trim();
    return (firstSentence || trimmed.replace(/\n/g, " ").trim()).slice(0, 40);
}

export function titleFromDefaultSessionMessage(message) {
    if (message?.role === "user") {
        return titleFromFirstUserMessage(message.userText || message.content);
    }
    if (message?.role === "assistant") {
        return titleFromAssistantReply(message.content);
    }
    return null;
}
