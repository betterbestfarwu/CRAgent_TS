import { isContextDividerMessage } from "@shared/chatMessages";
import { DEFAULT_CONTEXT_CONFIG } from "@shared/contextConfig";
import { estimateMessageTokens, estimateMessagesTokens, estimateTextTokens } from "@shared/tokenEstimator";
import { groupMessagesByApiRound } from "./contextGrouping.js";

export { DEFAULT_CONTEXT_CONFIG };

export const COMPACT_MIN_CONTEXT_MESSAGES = 6;
export const MAX_CONSECUTIVE_COMPACT_FAILURES = 3;
export const CONTEXT_WARNING_TOKENS = 20_000;
export const MICROCOMPACT_CLEARED_MARKER =
    "[Old tool result content cleared — re-run the tool if you need this data again]";

export const COMPACTABLE_TOOLS = new Set([
    "read_file",
    "bash",
    "list_dir",
    "web_fetch",
    "memory_get",
    "memory_search",
    "write_file",
]);

export const COMPACT_SUMMARIZE_SYSTEM = `You compress conversation history for context-window management.
Write your analysis inside <analysis>...</analysis>, then output ONLY the final summary inside <summary>...</summary>.
The summary must use this XML structure (keep section tags even when empty):

<summary>
<section name="primary_request">Primary request and intent</section>
<section name="technical_concepts">Key technical concepts</section>
<section name="files_and_code">Files and code sections (include paths and short snippets)</section>
<section name="errors_and_fixes">Errors and fixes</section>
<section name="problem_solving">Problem solving approach</section>
<section name="user_messages">ALL user messages verbatim — MUST NOT omit any user instruction</section>
<section name="pending_tasks">Pending tasks</section>
<section name="current_work">Current work in progress</section>
<section name="next_step">Optional next step with verbatim quotes where helpful</section>
</summary>

Rules:
- Match the conversation language.
- Preserve goals, decisions, file paths, code identifiers, errors, constraints, and unfinished tasks.
- Section user_messages is sacred: quote every user message in full.
- Do not invent facts.`;

const DEFAULT_CONTEXT = DEFAULT_CONTEXT_CONFIG;

export function getContextConfig(configStore) {
    return { ...DEFAULT_CONTEXT, ...(configStore.get().context || {}) };
}

export function getAutoCompactThreshold(model, contextConfig = DEFAULT_CONTEXT) {
    const contextWindow = model?.contextWindow ?? 0;
    if (!contextWindow) {
        return 0;
    }
    const maxOutput = model?.maxTokens ?? 8192;
    const reserved = Math.min(maxOutput, 20_000);
    const effectiveWindow = Math.max(0, contextWindow - reserved);
    const buffer = contextConfig.compact_buffer_tokens ?? DEFAULT_CONTEXT.compact_buffer_tokens;
    return Math.max(0, effectiveWindow - buffer);
}

export function shouldAutoCompact(session, model, contextConfig = DEFAULT_CONTEXT) {
    return calculateContextWarningState(session, model, contextConfig).isAboveAutoCompactThreshold;
}

export function calculateMessagesContextWarningState(
    messages,
    model,
    contextConfig = DEFAULT_CONTEXT,
    extraTokens = 0,
) {
    const tokens = estimateMessagesTokens(messages) + extraTokens;
    const contextWindow = model?.contextWindow ?? 0;
    const maxOutput = model?.maxTokens ?? 8192;
    const reserved = Math.min(maxOutput, 20_000);
    const effectiveWindow = Math.max(0, contextWindow - reserved);
    const autoCompactThreshold = getAutoCompactThreshold(model, contextConfig);
    const warningThreshold = Math.max(0, autoCompactThreshold - CONTEXT_WARNING_TOKENS);
    const blockingLimit = Math.max(0, effectiveWindow - 3000);

    return {
        tokens,
        contextWindow,
        effectiveWindow,
        autoCompactThreshold,
        warningThreshold,
        blockingLimit,
        percent: contextWindow ? Math.round((tokens * 100) / contextWindow) : 0,
        percentLeft: contextWindow
            ? Math.max(0, Math.round(((contextWindow - tokens) * 100) / contextWindow))
            : 100,
        isAboveWarningThreshold: tokens >= warningThreshold,
        isAboveAutoCompactThreshold: autoCompactThreshold > 0 && tokens >= autoCompactThreshold,
        isAtBlockingLimit: blockingLimit > 0 && tokens >= blockingLimit,
    };
}

export function calculateContextWarningState(session, model, contextConfig = DEFAULT_CONTEXT) {
    const fromIndex = Math.max(0, session.meta.llmContextFromIndex ?? 0);
    const active = session.messages
        .slice(fromIndex)
        .filter((message) => !isContextDividerMessage(message));

    let extraTokens = 0;
    if (session.meta.contextSummary) {
        extraTokens += estimateTextTokens(session.meta.contextSummary);
    }
    if (session.meta.postCompactContext) {
        extraTokens += estimateTextTokens(session.meta.postCompactContext);
    }
    if (session.meta.sessionMemory) {
        extraTokens += estimateTextTokens(session.meta.sessionMemory);
    }

    const failures = session.meta.compactFailures ?? 0;
    const autoCompactEnabled =
        Boolean(contextConfig.auto_compact_enabled) && failures < MAX_CONSECUTIVE_COMPACT_FAILURES;
    const state = calculateMessagesContextWarningState(active, model, contextConfig, extraTokens);

    return {
        ...state,
        isAboveAutoCompactThreshold:
            autoCompactEnabled && state.isAboveAutoCompactThreshold,
    };
}

/** Shrink in-memory sub-agent transcript: micro-compact tool output, then drop oldest rounds. */
export function shrinkSubAgentMessages(messages, contextConfig = DEFAULT_CONTEXT) {
    if (messages.length < 2) {
        return false;
    }

    let prefixLength = 0;
    if (messages[0]?.role === "system") {
        prefixLength = 1;
        if (messages[1]?.role === "user") {
            prefixLength = 2;
        }
    } else if (messages[0]?.role === "user") {
        prefixLength = 1;
    }

    const tail = messages.slice(prefixLength);
    if (!tail.length) {
        return false;
    }

    const { cleared } = microCompactMessages(tail, contextConfig, {
        keepRecent:
            contextConfig.precompact_keep_recent ?? DEFAULT_CONTEXT.precompact_keep_recent,
    });
    if (cleared) {
        return true;
    }

    const groups = groupMessagesByApiRound(tail);
    if (groups.length <= 1) {
        return false;
    }

    const trimmedTail = groups.slice(1).flat();
    messages.splice(prefixLength, messages.length - prefixLength, ...trimmedTail);
    return true;
}

export function trySessionMemoryCompact(session, entries, keepStartIndex) {
    const memory = session.meta.sessionMemory;
    const upToIndex = session.meta.sessionMemoryUpToIndex;
    if (!memory || typeof upToIndex !== "number" || keepStartIndex <= 0) {
        return { ok: false };
    }

    const lastSummarizedEntry = entries[keepStartIndex - 1];
    if (!lastSummarizedEntry || upToIndex < lastSummarizedEntry.index) {
        return { ok: false };
    }

    let summary = memory;
    if (session.meta.contextSummary && session.meta.contextSummary !== memory) {
        summary = `${session.meta.contextSummary}\n\n---\n\n${memory}`;
    }

    return { ok: true, summary, method: "session_memory" };
}

export function buildCompactTranscript(session, toSummarize, contextConfig = DEFAULT_CONTEXT) {
    const maxInputTokens =
        contextConfig.compact_max_input_tokens ?? DEFAULT_CONTEXT.compact_max_input_tokens;
    const maxRetries = contextConfig.compact_ptl_max_retries ?? DEFAULT_CONTEXT.compact_ptl_max_retries;
    const prefixParts = [];
    if (session.meta.contextSummary) {
        prefixParts.push(`Previous summary:\n${session.meta.contextSummary}`);
    }

    let groups = groupMessagesByApiRound(toSummarize);
    let droppedGroups = 0;

    for (let retry = 0; retry <= maxRetries; retry += 1) {
        const body = formatMessagesForSummary(groups.flat());
        const transcript = [...prefixParts, body].filter(Boolean).join("\n\n---\n\n");
        if (estimateTextTokens(transcript) <= maxInputTokens || groups.length <= 1) {
            return { transcript, droppedGroups };
        }
        groups = groups.slice(1);
        droppedGroups += 1;
    }

    const body = formatMessagesForSummary(groups.flat());
    return {
        transcript: [...prefixParts, body].filter(Boolean).join("\n\n---\n\n"),
        droppedGroups,
    };
}

export function formatCompactSummary(raw) {
    const text = String(raw || "").trim();
    const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i);
    if (summaryMatch) {
        return summaryMatch[1].trim();
    }
    return text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();
}

export function formatMessagesForSummary(messages) {
    return messages
        .map((message) => {
            if (message.role === "user") {
                const imageNote = message.images?.length
                    ? ` [${message.images.length} image(s)]`
                    : "";
                return `User: ${message.content || ""}${imageNote}`.trimEnd();
            }
            if (message.role === "assistant") {
                let line = `Assistant: ${message.content || ""}`.trimEnd();
                if (message.toolCalls?.length) {
                    const names = message.toolCalls
                        .map((call) => call.function?.name)
                        .filter(Boolean)
                        .join(", ");
                    if (names) {
                        line += `\n[tool_calls: ${names}]`;
                    }
                }
                return line;
            }
            if (message.role === "tool") {
                const body = String(message.content || "").slice(0, 1200);
                return `Tool (${message.name || "tool"}): ${body}`;
            }
            return "";
        })
        .filter(Boolean)
        .join("\n\n");
}

function isTextMessage(message) {
    return Boolean(String(message.content || "").trim());
}

function adjustKeepStartForToolPairs(messages, keepStartIndex) {
    let start = keepStartIndex;
    let changed = true;

    while (changed && start > 0) {
        changed = false;
        for (let index = start; index < messages.length; index += 1) {
            const message = messages[index];
            if (message.role !== "tool" || !message.toolCallId) {
                continue;
            }
            for (let prev = start - 1; prev >= 0; prev -= 1) {
                const candidate = messages[prev];
                if (
                    candidate.role === "assistant" &&
                    candidate.toolCalls?.some((call) => call.id === message.toolCallId)
                ) {
                    if (prev < start) {
                        start = prev;
                        changed = true;
                    }
                    break;
                }
            }
        }
    }

    return start;
}

export function splitMessagesForCompact(messages, contextConfig = DEFAULT_CONTEXT) {
    if (messages.length < COMPACT_MIN_CONTEXT_MESSAGES) {
        return { toSummarize: [], keep: messages, keepStartIndex: 0 };
    }

    const minTokens = contextConfig.keep_min_tokens ?? DEFAULT_CONTEXT.keep_min_tokens;
    const minTextMessages = contextConfig.keep_min_text_messages ?? DEFAULT_CONTEXT.keep_min_text_messages;
    const maxTokens = contextConfig.keep_max_tokens ?? DEFAULT_CONTEXT.keep_max_tokens;

    const keep = [];
    let tokens = 0;
    let textMessages = 0;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const messageTokens = estimateMessageTokens(message);
        if (
            keep.length &&
            (tokens + messageTokens > maxTokens ||
                (tokens >= minTokens && textMessages >= minTextMessages))
        ) {
            break;
        }
        keep.unshift(message);
        tokens += messageTokens;
        if (isTextMessage(message)) {
            textMessages += 1;
        }
    }

    while (tokens < minTokens || textMessages < minTextMessages) {
        const nextIndex = messages.length - keep.length - 1;
        if (nextIndex < 0) {
            break;
        }
        const message = messages[nextIndex];
        keep.unshift(message);
        tokens += estimateMessageTokens(message);
        if (isTextMessage(message)) {
            textMessages += 1;
        }
    }

    let keepStartIndex = messages.length - keep.length;
    keepStartIndex = adjustKeepStartForToolPairs(messages, keepStartIndex);
    const finalKeep = messages.slice(keepStartIndex);

    if (keepStartIndex <= 0) {
        return { toSummarize: [], keep: messages, keepStartIndex: 0 };
    }

    return {
        toSummarize: messages.slice(0, keepStartIndex),
        keep: finalKeep,
        keepStartIndex,
    };
}

export function microCompactMessages(messages, contextConfig = DEFAULT_CONTEXT, options = {}) {
    const idleMinutes = contextConfig.microcompact_idle_minutes ?? DEFAULT_CONTEXT.microcompact_idle_minutes;
    const idleKeepRecent =
        contextConfig.microcompact_idle_keep_recent ?? DEFAULT_CONTEXT.microcompact_idle_keep_recent;
    const defaultKeepRecent =
        contextConfig.microcompact_keep_recent ?? DEFAULT_CONTEXT.microcompact_keep_recent;
    const forcedKeepRecent = options.keepRecent;

    let keepRecent = forcedKeepRecent ?? defaultKeepRecent;
    if (forcedKeepRecent === undefined && getMinutesSinceLastAssistant(messages) >= idleMinutes) {
        keepRecent = idleKeepRecent;
    }

    const toolIndices = [];

    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.role !== "tool") {
            continue;
        }
        if (!COMPACTABLE_TOOLS.has(message.name)) {
            continue;
        }
        if (message.content === MICROCOMPACT_CLEARED_MARKER) {
            continue;
        }
        toolIndices.push(index);
    }

    const toClear = toolIndices.slice(0, Math.max(0, toolIndices.length - keepRecent));
    let cleared = 0;
    let savedTokens = 0;

    for (const index of toClear) {
        const message = messages[index];
        savedTokens += estimateMessageTokens(message);
        message.content = MICROCOMPACT_CLEARED_MARKER;
        message.contentCleared = true;
        cleared += 1;
    }

    return { cleared, savedTokens, keepRecent };
}

export function preCompactMicroCompact(messages, contextConfig = DEFAULT_CONTEXT) {
    const keepRecent = contextConfig.precompact_keep_recent ?? DEFAULT_CONTEXT.precompact_keep_recent;
    return microCompactMessages(messages, contextConfig, { keepRecent });
}

function getMinutesSinceLastAssistant(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "assistant") {
            continue;
        }
        const timestamp = Date.parse(message.createdAt || "");
        if (!Number.isFinite(timestamp)) {
            return 0;
        }
        return (Date.now() - timestamp) / 60_000;
    }
    return Number.POSITIVE_INFINITY;
}

export function trackLoadedSkill(session, skillName, content, contextConfig = DEFAULT_CONTEXT) {
    const maxSkills = contextConfig.post_compact_max_skills ?? DEFAULT_CONTEXT.post_compact_max_skills;
    const maxPerSkill =
        contextConfig.post_compact_max_tokens_per_skill ?? DEFAULT_CONTEXT.post_compact_max_tokens_per_skill;
    const maxChars = maxPerSkill * 4;

    const recentSkills = Array.isArray(session.meta.recentSkills) ? [...session.meta.recentSkills] : [];
    const snippet = String(content || "").slice(0, maxChars);
    const next = recentSkills.filter((entry) => entry.name !== skillName);
    next.push({
        name: skillName,
        snippet,
        loadedAt: new Date().toISOString(),
    });
    session.meta.recentSkills = next.slice(-maxSkills);
}

export function trackReadFile(session, filePath, content, contextConfig = DEFAULT_CONTEXT) {
    const maxFiles = contextConfig.post_compact_max_files ?? DEFAULT_CONTEXT.post_compact_max_files;
    const maxPerFile =
        contextConfig.post_compact_max_tokens_per_file ?? DEFAULT_CONTEXT.post_compact_max_tokens_per_file;
    const maxChars = maxPerFile * 4;

    const recentFiles = Array.isArray(session.meta.recentFiles) ? [...session.meta.recentFiles] : [];
    const snippet = String(content || "").slice(0, maxChars);
    const next = recentFiles.filter((entry) => entry.path !== filePath);
    next.push({
        path: filePath,
        snippet,
        readAt: new Date().toISOString(),
    });
    session.meta.recentFiles = next.slice(-maxFiles);
}

export function buildPostCompactContext(session, contextConfig = DEFAULT_CONTEXT) {
    const budget = contextConfig.post_compact_token_budget ?? DEFAULT_CONTEXT.post_compact_token_budget;
    const skillsBudget =
        contextConfig.post_compact_skills_token_budget ?? DEFAULT_CONTEXT.post_compact_skills_token_budget;
    const maxPerFile =
        contextConfig.post_compact_max_tokens_per_file ?? DEFAULT_CONTEXT.post_compact_max_tokens_per_file;
    const maxPerSkill =
        contextConfig.post_compact_max_tokens_per_skill ?? DEFAULT_CONTEXT.post_compact_max_tokens_per_skill;
    const maxCharsFile = maxPerFile * 4;
    const maxCharsSkill = maxPerSkill * 4;

    let usedTokens = 0;
    const parts = [];

    const recentFiles = session.meta.recentFiles;
    if (Array.isArray(recentFiles) && recentFiles.length) {
        for (const entry of [...recentFiles].reverse()) {
            const snippet = String(entry.snippet || "").slice(0, maxCharsFile);
            const chunk = `<file path="${entry.path}">\n${snippet}\n</file>`;
            const chunkTokens = estimateTextTokens(chunk);
            if (usedTokens + chunkTokens > budget) {
                break;
            }
            parts.unshift(chunk);
            usedTokens += chunkTokens;
        }
    }

    const recentSkills = session.meta.recentSkills;
    if (Array.isArray(recentSkills) && recentSkills.length) {
        const skillParts = [];
        let skillTokens = 0;
        for (const entry of [...recentSkills].reverse()) {
            const snippet = String(entry.snippet || "").slice(0, maxCharsSkill);
            const chunk = `<skill name="${entry.name}">\n${snippet}\n</skill>`;
            const chunkTokens = estimateTextTokens(chunk);
            if (skillTokens + chunkTokens > skillsBudget) {
                break;
            }
            skillParts.unshift(chunk);
            skillTokens += chunkTokens;
        }
        parts.push(...skillParts);
        usedTokens += skillParts.reduce((sum, chunk) => sum + estimateTextTokens(chunk), 0);
    }

    if (!parts.length) {
        return null;
    }

    return `<recent_context_after_compact>\n${parts.join("\n\n")}\n</recent_context_after_compact>`;
}

export function parseReadFileResult(content, args = {}) {
    const text = String(content || "");
    const match = text.match(/<file path="([^"]+)"/);
    const path = match?.[1] || args.path;
    if (!path) {
        return null;
    }
    const bodyMatch = text.match(/>\n([\s\S]*)\n<\/file>/);
    return {
        path,
        content: bodyMatch?.[1] || text,
    };
}
