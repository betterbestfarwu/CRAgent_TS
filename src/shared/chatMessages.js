/** UI-only marker: not sent to the LLM. */
export const CONTEXT_DIVIDER_ROLE = "context_divider";

/** Shown on the context reset divider after /clear or /reset. */
export const CONTEXT_DIVIDER_LABEL = "上文仅供查阅 · 已移出模型上下文";

/** Shown on the divider inserted by /compact. */
export const CONTEXT_COMPACT_DIVIDER_LABEL = "较早对话已压缩为摘要 · 下文为当前模型上下文";

export function isContextDividerMessage(message) {
    return message?.role === CONTEXT_DIVIDER_ROLE;
}

export function isContextClearDivider(message) {
    return isContextDividerMessage(message) && message.content === CONTEXT_DIVIDER_LABEL;
}

export function isContextCompactDivider(message) {
    return isContextDividerMessage(message) && message.content === CONTEXT_COMPACT_DIVIDER_LABEL;
}

/**
 * Derive LLM context window for a forked message slice from context dividers.
 * Uses divider position in the forked array (not parent session meta).
 * Compact summaries are read from the divider when present, with source meta as fallback.
 */
export function resolveForkLlmContext(messages, sourceMeta = {}) {
    let llmContextFromIndex = 0;
    let contextSummary;
    let postCompactContext;
    let lastCompactDividerIndex = -1;

    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (!isContextDividerMessage(message)) {
            continue;
        }
        llmContextFromIndex = index + 1;
        if (isContextCompactDivider(message)) {
            lastCompactDividerIndex = index;
            contextSummary = message.contextSummary;
            postCompactContext = message.postCompactContext;
        } else {
            contextSummary = undefined;
            postCompactContext = undefined;
        }
    }

    if (
        lastCompactDividerIndex >= 0 &&
        !contextSummary &&
        sourceMeta.contextSummary &&
        (sourceMeta.llmContextFromIndex ?? 0) === lastCompactDividerIndex + 1
    ) {
        contextSummary = sourceMeta.contextSummary;
        postCompactContext = sourceMeta.postCompactContext;
    }

    llmContextFromIndex = Math.min(llmContextFromIndex, messages.length);
    return {
        llmContextFromIndex: llmContextFromIndex > 0 ? llmContextFromIndex : undefined,
        contextSummary,
        postCompactContext,
    };
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

/** Stable wire fingerprint for user image metadata (ignores data_url vs image_src churn). */
export function userImagesWireFingerprint(messages) {
    return JSON.stringify(
        (messages || [])
            .filter((message) => message?.role === "user")
            .map((message) => ({
                id: message.id,
                images: (message.images || []).map((image, index) => ({
                    i: image?.index ?? index,
                    h: Boolean(image?.has_data),
                    f: image?.image_file || "",
                })),
            })),
    );
}

/** User wire payload for patch checks; drops transient image src payloads. */
export function stableUserWireMessage(message) {
    if (!message || message.role !== "user") {
        return message;
    }
    const stable = { ...message };
    if (stable.images) {
        stable.images = stable.images.map((image, index) => ({
            index: image?.index ?? index,
            mime_type: image?.mime_type || "",
            has_data: Boolean(image?.has_data),
            image_file: image?.image_file || "",
        }));
    }
    return stable;
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
        if (message?.role === "user") {
            return Boolean(message?.images?.length || message?.image_count);
        }
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

/** Last message index (inclusive) for the turn containing messageId. */
export function findTurnEndIndex(messages, messageId) {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return -1;

    const target = messages[index];
    const runId = getMessageRunId(target);
    if (runId) {
        let endIndex = index;
        for (let i = 0; i < messages.length; i += 1) {
            if (getMessageRunId(messages[i]) === runId) {
                endIndex = i;
            }
        }
        return endIndex;
    }

    return index;
}

/** Messages from the start through the turn containing messageId (for session fork). */
export function collectMessagesUpToTurn(messages, messageId) {
    const endIndex = findTurnEndIndex(messages, messageId);
    if (endIndex < 0) {
        return [];
    }
    return messages.slice(0, endIndex + 1);
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
