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
        return `${(n / 1000).toFixed(1)}K`;
    }
    return `${n}`;
}

export const CONTEXT_BREAKDOWN_CATEGORIES = [
    { id: "systemPrompt", label: "System prompt", color: "#9ca3af" },
    { id: "toolDefinitions", label: "Tool definitions", color: "#a855f7" },
    { id: "rules", label: "Rules", color: "#22c55e" },
    { id: "skills", label: "Skills", color: "#eab308" },
    { id: "mcp", label: "MCP", color: "#ec4899" },
    { id: "subagentDefinitions", label: "Subagent definitions", color: "#3b82f6" },
    { id: "conversation", label: "Conversation", color: "#ea580c" },
];

const AGENTS_RULES_ESTIMATE = 3700;
export const TOKENS_PER_TOOL_SCHEMA = 620;

function estimateRulesTokens(todos) {
    let tokens = AGENTS_RULES_ESTIMATE;
    if (todos?.length) {
        const lines = todos.map((item) => `- [${item.status}] ${item.id}: ${item.content}`);
        tokens += estimateTextTokens(`<active_todos>\n${lines.join("\n")}\n</active_todos>`);
    }
    return tokens;
}

function estimateToolDefinitionsTokens(agentTools = {}) {
    if (agentTools.enable_tools === false) {
        return 0;
    }
    let count = 1;
    if (agentTools.enable_file_tools !== false) {
        count += 3;
    }
    count += 4;
    if (agentTools.enable_skills !== false) {
        count += 3;
    }
    if (agentTools.allow_sub_agents) {
        count += 1;
    }
    return count * TOKENS_PER_TOOL_SCHEMA;
}

function reconcileBreakdownCategories(categories, targetTotal) {
    const order = CONTEXT_BREAKDOWN_CATEGORIES.map((category) => category.id);
    const sorted = [...categories].sort(
        (left, right) => order.indexOf(left.id) - order.indexOf(right.id),
    );

    let total = sorted.reduce((sum, category) => sum + category.tokens, 0);
    if (!sorted.length || total === targetTotal) {
        return sorted;
    }

    if (total < targetTotal) {
        const delta = targetTotal - total;
        const systemCategory = sorted.find((category) => category.id === "systemPrompt");
        if (systemCategory) {
            systemCategory.tokens += delta;
        } else {
            const definition = CONTEXT_BREAKDOWN_CATEGORIES.find(
                (category) => category.id === "systemPrompt",
            );
            sorted.unshift({ ...definition, tokens: delta });
        }
        return sorted;
    }

    const scale = targetTotal / total;
    const scaled = sorted.map((category) => ({
        ...category,
        tokens: Math.floor(category.tokens * scale),
    }));

    let remainder = targetTotal - scaled.reduce((sum, category) => sum + category.tokens, 0);
    for (const category of scaled) {
        if (remainder <= 0) {
            break;
        }
        category.tokens += 1;
        remainder -= 1;
    }

    return scaled.filter((category) => category.tokens > 0);
}

export function estimateSessionContextBreakdown(session, model, options = {}) {
    const usage = estimateSessionContextUsage(session, model, options);
    const fromIndex = Math.max(0, session.meta.llmContextFromIndex ?? 0);
    const active = session.messages
        .slice(fromIndex)
        .filter((message) => !isContextDividerMessage(message));

    let conversationTokens = estimateMessagesTokens(active);
    if (session.meta.contextSummary) {
        conversationTokens += estimateTextTokens(session.meta.contextSummary);
    }
    if (session.meta.postCompactContext) {
        conversationTokens += estimateTextTokens(session.meta.postCompactContext);
    }
    if (session.meta.sessionMemory) {
        conversationTokens += estimateTextTokens(session.meta.sessionMemory);
    }

    const agentTools = options.agentTools || {};
    const toolDefinitions = estimateToolDefinitionsTokens(agentTools);
    const skills =
        options.skillsCatalogText && agentTools.enable_skills !== false
            ? estimateTextTokens(options.skillsCatalogText)
            : agentTools.enable_skills !== false
              ? 1200
              : 0;
    const rules = estimateRulesTokens(session.meta.todos);
    const mcp = options.mcpTokens ?? 0;
    const subagentDefinitions = agentTools.allow_sub_agents ? 406 : 0;

    const systemPrompt = Math.max(
        0,
        usage.tokens -
            conversationTokens -
            toolDefinitions -
            skills -
            rules -
            mcp -
            subagentDefinitions,
    );

    const byId = {
        systemPrompt,
        toolDefinitions,
        rules,
        skills,
        mcp,
        subagentDefinitions,
        conversation: conversationTokens,
    };

    const categories = reconcileBreakdownCategories(
        CONTEXT_BREAKDOWN_CATEGORIES.map((category) => ({
            ...category,
            tokens: byId[category.id] ?? 0,
        })).filter((category) => category.tokens > 0),
        usage.tokens,
    );

    return {
        ...usage,
        categories,
    };
}

/** @deprecated Use estimateSessionContextUsage or estimateMessagesTokens */
export function estimateTokens(messages) {
    return estimateMessagesTokens(messages);
}
