import { isContextDividerMessage } from "./chatMessages.js";

const IMAGE_TOKEN_ESTIMATE = 2000;
const TOKEN_PADDING_RATIO = 4 / 3;
const DEFAULT_BOOTSTRAP_OVERHEAD = 8000;
const DEFAULT_COMPACT_BUFFER = 13_000;
const CONTEXT_WARNING_TOKENS = 20_000;

export function estimateTextTokens(text) {
    const chars = String(text || "").length;
    return Math.max(0, Math.ceil((chars / 4) * TOKEN_PADDING_RATIO));
}

export function estimateMessageTokens(message) {
    if (!message || isContextDividerMessage(message)) {
        return 0;
    }

    let tokens = estimateTextTokens(message.content);

    if (message.images?.length) {
        tokens += message.images.length * IMAGE_TOKEN_ESTIMATE;
    }

    if (message.toolCalls?.length) {
        for (const call of message.toolCalls) {
            tokens += estimateTextTokens(call.function?.name);
            tokens += estimateTextTokens(call.function?.arguments);
        }
    }

    return tokens;
}

export function estimateMessagesTokens(messages) {
    return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

export function estimateSessionContextUsage(session, model, options = {}) {
    const bootstrapOverhead = options.bootstrapOverhead ?? DEFAULT_BOOTSTRAP_OVERHEAD;
    const fromIndex = Math.max(0, session.meta.llmContextFromIndex ?? 0);
    const active = session.messages
        .slice(fromIndex)
        .filter((message) => !isContextDividerMessage(message));

    let tokens = estimateMessagesTokens(active);
    if (session.meta.contextSummary) {
        tokens += estimateTextTokens(session.meta.contextSummary);
    }
    if (session.meta.postCompactContext) {
        tokens += estimateTextTokens(session.meta.postCompactContext);
    }
    if (session.meta.sessionMemory) {
        tokens += estimateTextTokens(session.meta.sessionMemory);
    }
    tokens += bootstrapOverhead;

    const contextWindow = model?.contextWindow ?? 0;
    const maxOutput = model?.maxTokens ?? 8192;
    const reserved = Math.min(maxOutput, 20_000);
    const effectiveWindow = Math.max(0, contextWindow - reserved);
    const compactBuffer = options.compactBufferTokens ?? DEFAULT_COMPACT_BUFFER;
    const autoCompactThreshold = Math.max(0, effectiveWindow - compactBuffer);
    const warningThreshold = Math.max(0, autoCompactThreshold - CONTEXT_WARNING_TOKENS);

    return {
        tokens,
        contextWindow,
        effectiveWindow,
        autoCompactThreshold,
        warningThreshold,
        percent: contextWindow ? Math.round((tokens * 100) / contextWindow) : 0,
        percentLeft: contextWindow
            ? Math.max(0, Math.round(((contextWindow - tokens) * 100) / contextWindow))
            : 100,
        isAboveWarningThreshold: tokens >= warningThreshold,
        isAboveAutoCompactThreshold: autoCompactThreshold > 0 && tokens >= autoCompactThreshold,
    };
}

export function formatTokens(n) {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(1)}M`;
    }
    if (n >= 1000) {
        return `${(n / 1000).toFixed(1)}k`;
    }
    return `${n}`;
}

/** @deprecated Use estimateSessionContextUsage or estimateMessagesTokens */
export function estimateTokens(messages) {
    return estimateMessagesTokens(messages);
}
