/** UI-only marker: not sent to the LLM. */
export const CONTEXT_DIVIDER_ROLE = "context_divider";

/** Shown on the context reset divider after /clear or /reset. */
export const CONTEXT_DIVIDER_LABEL = "上文仅供查阅 · 已移出模型上下文";

/** Shown on the divider inserted by /compact. */
export const CONTEXT_COMPACT_DIVIDER_LABEL = "较早对话已压缩为摘要 · 下文为当前模型上下文";

export function isContextDividerMessage(message) {
    return message?.role === CONTEXT_DIVIDER_ROLE;
}

export function getMessageRunId(message) {
    return message?.runId ?? message?.run_id ?? null;
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
