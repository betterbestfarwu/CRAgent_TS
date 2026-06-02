/** UI-only marker: not sent to the LLM. */
export const CONTEXT_DIVIDER_ROLE = "context_divider";

/** Shown on the context reset divider after /clear or /reset. */
export const CONTEXT_DIVIDER_LABEL = "上文仅供查阅 · 已移出模型上下文";

/** Shown on the divider inserted by /compact. */
export const CONTEXT_COMPACT_DIVIDER_LABEL = "较早对话已压缩为摘要 · 下文为当前模型上下文";

export function isContextDividerMessage(message) {
    return message?.role === CONTEXT_DIVIDER_ROLE;
}

/** Messages currently sent to the LLM (after the last context reset, excluding dividers). */
export function getActiveLlmContextEntries(session) {
    const messages = session?.messages || [];
    const fromIndex = Math.max(0, session?.meta?.llmContextFromIndex ?? 0);
    const entries = [];
    for (let index = fromIndex; index < messages.length; index += 1) {
        const message = messages[index];
        if (!isContextDividerMessage(message)) {
            entries.push({ message, index });
        }
    }
    return entries;
}

export function sessionHasActiveLlmContext(session) {
    return getActiveLlmContextEntries(session).length > 0;
}

/** Collapse back-to-back context dividers with the same label for chat UI. */
export function dedupeConsecutiveContextDividers(messages) {
    if (!messages?.length) {
        return messages || [];
    }
    const result = [];
    for (const message of messages) {
        if (isContextDividerMessage(message) && result.length > 0) {
            const previous = result[result.length - 1];
            if (isContextDividerMessage(previous) && previous.content === message.content) {
                continue;
            }
        }
        result.push(message);
    }
    return result;
}

export function getMessageRunId(message) {
    return message?.runId ?? message?.run_id ?? null;
}

/**
 * True when chat iframe should renderAll instead of patchActiveRun for new tail
 * messages (context dividers; assistant-only hook blocks without a user turn).
 */
export function appendedMessagesNeedFullRender(allMessages, previousCount) {
    const appended = (allMessages || []).slice(previousCount);
    if (!appended.length) {
        return false;
    }
    if (appended.some(isContextDividerMessage)) {
        return true;
    }
    return appended.some((message) => {
        if (message?.role !== "assistant") {
            return false;
        }
        const runId = getMessageRunId(message);
        if (!runId) {
            // Standalone notices (/compact feedback, "context too short", etc.)
            return true;
        }
        return !(allMessages || []).some(
            (candidate) => candidate?.role === "user" && getMessageRunId(candidate) === runId,
        );
    });
}

export function getMessageModelId(message) {
    return message?.modelId ?? message?.model_id ?? null;
}

export function withAssistantModel(message, model) {
    if (!message || message.role !== "assistant" || !model?.modelId) {
        return message;
    }
    return { ...message, modelId: model.modelId };
}

function isProcessMessage(message) {
    if (!message) return false;
    if (message.role === "tool") return true;
    return message.role === "assistant" && Boolean(message.toolCalls?.length);
}

/** IDs to remove when deleting one message (same run, or legacy thinking chain). */
export function collectMessageIdsForDeletion(messages, messageId) {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return [];

    const target = messages[index];
    const runId = getMessageRunId(target);
    if (runId) {
        return messages.filter((message) => getMessageRunId(message) === runId).map((message) => message.id);
    }

    const ids = new Set([target.id]);

    if (target.role === "assistant" && !isProcessMessage(target)) {
        for (let i = index - 1; i >= 0; i -= 1) {
            const message = messages[i];
            if (message.role === "user") break;
            if (isProcessMessage(message)) {
                ids.add(message.id);
                continue;
            }
            break;
        }
    }

    return [...ids];
}
