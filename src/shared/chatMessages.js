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
 * Derive LLM context anchor for a forked message slice from the last context divider.
 */
export function resolveForkLlmContext(messages, sourceMeta = {}) {
    const lastDivider = getLastContextDividerMessage(messages);
    let contextSummary;
    let postCompactContext;

    if (lastDivider && isContextCompactDivider(lastDivider)) {
        contextSummary = lastDivider.contextSummary;
        postCompactContext = lastDivider.postCompactContext;
    } else if (lastDivider) {
        contextSummary = undefined;
        postCompactContext = undefined;
    }

    if (
        lastDivider &&
        isContextCompactDivider(lastDivider) &&
        !contextSummary &&
        sourceMeta.contextSummary &&
        sourceMeta.llmContextDividerId === lastDivider.id
    ) {
        contextSummary = sourceMeta.contextSummary;
        postCompactContext = sourceMeta.postCompactContext;
    }

    return {
        llmContextDividerId: lastDivider?.id,
        contextSummary,
        postCompactContext,
    };
}

export function getLastContextDividerMessage(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (isContextDividerMessage(message)) {
            return message;
        }
    }
    return null;
}

function findContextDividerIndex(messages, dividerId) {
    if (!dividerId) {
        return -1;
    }
    return messages.findIndex((message) => message.id === dividerId);
}

/** Array index where active LLM context begins (first message after the anchored divider). */
export function getActiveLlmContextStartIndex(session) {
    const messages = session?.messages || [];
    const meta = session?.meta || {};

    if (meta.llmContextDividerId) {
        const dividerIndex = findContextDividerIndex(messages, meta.llmContextDividerId);
        if (dividerIndex >= 0) {
            return dividerIndex + 1;
        }
        const lastDivider = getLastContextDividerMessage(messages);
        return lastDivider ? findContextDividerIndex(messages, lastDivider.id) + 1 : 0;
    }

    if (meta.llmContextFromIndex != null) {
        return Math.max(0, Math.min(meta.llmContextFromIndex, messages.length));
    }

    return 0;
}

function syncCompactMetaFromDivider(meta, divider) {
    if (isContextCompactDivider(divider)) {
        let contextSummary = divider.contextSummary;
        let postCompactContext = divider.postCompactContext;
        if (!contextSummary && meta.contextSummary) {
            contextSummary = meta.contextSummary;
            postCompactContext = meta.postCompactContext;
        }
        if (contextSummary) {
            meta.contextSummary = contextSummary;
        } else {
            delete meta.contextSummary;
        }
        if (postCompactContext) {
            meta.postCompactContext = postCompactContext;
        } else {
            delete meta.postCompactContext;
        }
        return;
    }
    delete meta.contextSummary;
    delete meta.postCompactContext;
}

function stripLegacyDividerIndices(messages) {
    for (const message of messages) {
        if (isContextDividerMessage(message) && message.llmContextFromIndex != null) {
            delete message.llmContextFromIndex;
        }
    }
}

/** Migrate legacy llmContextFromIndex and repair stale divider ids after load. */
export function normalizeLlmContextMeta(meta, messages) {
    if (!meta) {
        return;
    }

    if (meta.llmContextDividerId) {
        if (findContextDividerIndex(messages, meta.llmContextDividerId) < 0) {
            const lastDivider = getLastContextDividerMessage(messages);
            if (lastDivider) {
                meta.llmContextDividerId = lastDivider.id;
            } else {
                delete meta.llmContextDividerId;
            }
        }
        delete meta.llmContextFromIndex;
        const divider = messages.find((message) => message.id === meta.llmContextDividerId);
        if (divider) {
            syncCompactMetaFromDivider(meta, divider);
        }
        stripLegacyDividerIndices(messages);
        return;
    }

    if (meta.llmContextFromIndex == null) {
        stripLegacyDividerIndices(messages);
        return;
    }

    const legacyStart = meta.llmContextFromIndex;
    if (legacyStart > 0 && legacyStart <= messages.length) {
        const candidate = messages[legacyStart - 1];
        if (isContextDividerMessage(candidate)) {
            meta.llmContextDividerId = candidate.id;
        }
    }
    if (!meta.llmContextDividerId && legacyStart < messages.length) {
        const lastDivider = getLastContextDividerMessage(messages);
        if (lastDivider) {
            meta.llmContextDividerId = lastDivider.id;
        }
    }
    delete meta.llmContextFromIndex;
    stripLegacyDividerIndices(messages);
    if (meta.llmContextDividerId) {
        const divider = messages.find((message) => message.id === meta.llmContextDividerId);
        if (divider) {
            syncCompactMetaFromDivider(meta, divider);
        }
    }
}

function hasConversationMessages(messages) {
    return (messages || []).some((message) => !isContextDividerMessage(message));
}

function pruneContextDividersWithoutBothSides(messages) {
    if (!messages?.length) {
        return messages || [];
    }

    return messages.filter((message, index) => {
        if (!isContextDividerMessage(message)) {
            return true;
        }
        const hasConversationBefore = messages
            .slice(0, index)
            .some((item) => !isContextDividerMessage(item));
        const hasConversationAfter = messages
            .slice(index + 1)
            .some((item) => !isContextDividerMessage(item));
        return hasConversationBefore && hasConversationAfter;
    });
}

function clearLlmContextMeta(meta) {
    delete meta.llmContextDividerId;
    delete meta.llmContextFromIndex;
    delete meta.contextSummary;
    delete meta.postCompactContext;
    delete meta.recentFiles;
    delete meta.recentSkills;
    delete meta.sessionMemory;
    delete meta.sessionMemoryUpToIndex;
    delete meta.sessionMemoryUpdatedAt;
    delete meta.sessionMemoryRefreshBusy;
    meta.compactFailures = 0;
}

/** Drop the later of two adjacent context dividers. */
export function removeAdjacentDuplicateContextDividers(messages) {
    if (!messages?.length) {
        return messages || [];
    }
    let result = messages;
    let changed = true;
    while (changed) {
        changed = false;
        const next = [];
        for (const message of result) {
            if (
                isContextDividerMessage(message) &&
                next.length > 0 &&
                isContextDividerMessage(next[next.length - 1])
            ) {
                changed = true;
                continue;
            }
            next.push(message);
        }
        result = next;
    }
    return result;
}

function syncLlmContextDividerMeta(meta, messages) {
    delete meta.llmContextFromIndex;
    stripLegacyDividerIndices(messages);
    const lastDivider = getLastContextDividerMessage(messages);
    if (lastDivider) {
        meta.llmContextDividerId = lastDivider.id;
        syncCompactMetaFromDivider(meta, lastDivider);
        return;
    }
    delete meta.llmContextDividerId;
    delete meta.contextSummary;
    delete meta.postCompactContext;
}

/**
 * After messages are removed, repair divider anchor and meta.
 * Deleting messages before the anchored divider does not require meta updates.
 */
export function reconcileLlmContextAfterMessageRemoval(session) {
    let messages = session?.messages || [];
    const meta = session.meta || (session.meta = {});

    if (!hasConversationMessages(messages)) {
        messages = [];
        session.messages = messages;
        clearLlmContextMeta(meta);
        return session;
    }

    messages = pruneContextDividersWithoutBothSides(
        removeAdjacentDuplicateContextDividers(messages),
    );
    session.messages = messages;

    if (
        meta.llmContextDividerId &&
        findContextDividerIndex(messages, meta.llmContextDividerId) < 0
    ) {
        delete meta.llmContextDividerId;
    }

    syncLlmContextDividerMeta(meta, messages);
    return session;
}

/** Messages currently sent to the LLM (after the last context reset, excluding dividers). */
export function getActiveLlmContextEntries(session) {
    const messages = session?.messages || [];
    const fromIndex = getActiveLlmContextStartIndex(session);
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

function collectUserRunIds(messages) {
    const runIds = new Set();
    for (const message of messages || []) {
        if (message?.role !== "user") {
            continue;
        }
        const runId = getMessageRunId(message);
        if (runId) {
            runIds.add(runId);
        }
    }
    return runIds;
}

function hasPairedUserRun(message, userRunIds) {
    const runId = getMessageRunId(message);
    return Boolean(runId && userRunIds.has(runId));
}

/** Drop assistant/tool rows with no user message sharing the same runId. */
export function excludeUnpairedAssistantAndToolMessages(messages) {
    const userRunIds = collectUserRunIds(messages);
    return (messages || []).filter((message) => {
        if (message?.role === "assistant" || message?.role === "tool") {
            return hasPairedUserRun(message, userRunIds);
        }
        return true;
    });
}

function userMessageContentKey(message) {
    return String(message?.content ?? "").trim();
}

/** Collapse back-to-back user messages when trimmed content is identical. */
export function mergeAdjacentSameContentUserMessages(messages) {
    const result = [];
    for (const message of messages || []) {
        if (message?.role === "user" && result.length > 0) {
            const previous = result[result.length - 1];
            if (
                previous.role === "user" &&
                userMessageContentKey(previous) === userMessageContentKey(message)
            ) {
                continue;
            }
        }
        result.push(message);
    }
    return result;
}

function createPaddedAssistant() {
    return {
        role: "assistant",
        content: "",
    };
}

/** Insert empty assistant turns between consecutive user messages. */
export function padMissingAssistantsBetweenUsers(messages) {
    const result = [];
    for (const message of messages || []) {
        if (message?.role === "user" && result.length > 0) {
            const previous = result[result.length - 1];
            if (previous.role === "user") {
                result.push(createPaddedAssistant());
            }
        }
        result.push(message);
    }
    return result;
}

/**
 * Normalize session history before sending to the LLM:
 * exclude orphan assistant/tool, merge duplicate adjacent users, pad missing assistants.
 */
export function normalizeMessagesForLlm(messages) {
    const filtered = excludeUnpairedAssistantAndToolMessages(messages);
    const merged = mergeAdjacentSameContentUserMessages(filtered);
    return padMissingAssistantsBetweenUsers(merged);
}

const COMPUTER_SCREENSHOT_TOOL_NAMES = new Set(["computer_screenshot", "computer_action"]);

function isComputerScreenshotToolMessage(message) {
    if (message?.role !== "tool" || !message?.images?.length) {
        return false;
    }
    if (message.name === "computer_screenshot") {
        return true;
    }
    if (message.name === "computer_action") {
        return /screenshot captured/i.test(String(message.content || ""));
    }
    return false;
}

/** Keep only the newest computer screenshots in LLM context to avoid vision payload bloat. */
export function trimStaleComputerScreenshots(messages, keepLast = 2) {
    const screenshotIndices = [];
    for (let index = 0; index < (messages || []).length; index += 1) {
        if (isComputerScreenshotToolMessage(messages[index])) {
            screenshotIndices.push(index);
        }
    }
    const stripCount = Math.max(0, screenshotIndices.length - Math.max(1, keepLast));
    if (!stripCount) {
        return messages;
    }
    const stripIndices = new Set(screenshotIndices.slice(0, stripCount));
    return (messages || []).map((message, index) => {
        if (!stripIndices.has(index)) {
            return message;
        }
        const suffix = "\n\n[Earlier screenshot omitted from context to save tokens.]";
        const content = String(message.content || "");
        return {
            ...message,
            images: undefined,
            content: content.includes("[Earlier screenshot omitted") ? content : `${content}${suffix}`,
        };
    });
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
