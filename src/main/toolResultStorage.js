import fsPromises from "node:fs/promises";
import path from "node:path";
import {
    DEFAULT_MAX_RESULT_SIZE_CHARS,
    formatByteSize,
    MAX_TOOL_RESULTS_PER_ROUND_CHARS,
    PERSISTED_OUTPUT_CLOSING_TAG,
    PERSISTED_OUTPUT_TAG,
    resolveMaxResultSizeChars,
    TOOL_RESULT_PREVIEW_CHARS,
} from "@shared/toolLimits.js";
import { sessionDir } from "./sessionStorage.js";

export const TOOL_RESULTS_SUBDIR = "tool-results";

export function getToolResultsDir(sessionsDir, sessionId) {
    return path.join(sessionDir(sessionsDir, sessionId), TOOL_RESULTS_SUBDIR);
}

export function getToolResultPath(sessionsDir, sessionId, toolUseId) {
    const safeId = String(toolUseId || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(getToolResultsDir(sessionsDir, sessionId), `${safeId}.txt`);
}

export function isToolResultContentEmpty(content) {
    return !String(content || "").trim();
}

export function ensureNonEmptyToolContent(content, toolName) {
    if (!isToolResultContentEmpty(content)) {
        return String(content);
    }
    return `(${toolName} completed with no output)`;
}

export function isPersistedToolResultContent(content) {
    return typeof content === "string" && content.startsWith(PERSISTED_OUTPUT_TAG);
}

export function generatePreview(content, maxChars = TOOL_RESULT_PREVIEW_CHARS) {
    const text = String(content || "");
    if (text.length <= maxChars) {
        return { preview: text, hasMore: false };
    }
    const truncated = text.slice(0, maxChars);
    const lastNewline = truncated.lastIndexOf("\n");
    const cutPoint = lastNewline > maxChars * 0.5 ? lastNewline : maxChars;
    return { preview: text.slice(0, cutPoint), hasMore: true };
}

export function buildLargeToolResultMessage({ filepath, originalSize, preview, hasMore }) {
    let message = `${PERSISTED_OUTPUT_TAG}\n`;
    message += `Output too large (${formatByteSize(originalSize)}). Full output saved to: ${filepath}\n\n`;
    message += `Preview (first ${formatByteSize(TOOL_RESULT_PREVIEW_CHARS)}):\n`;
    message += preview;
    message += hasMore ? "\n...\n" : "\n";
    message += PERSISTED_OUTPUT_CLOSING_TAG;
    return message;
}

async function ensureToolResultsDir(sessionsDir, sessionId) {
    const dir = getToolResultsDir(sessionsDir, sessionId);
    await fsPromises.mkdir(dir, { recursive: true });
    return dir;
}

export async function persistToolResult(content, sessionsDir, sessionId, toolUseId) {
    const text = String(content || "");
    await ensureToolResultsDir(sessionsDir, sessionId);
    const filepath = getToolResultPath(sessionsDir, sessionId, toolUseId);
    try {
        await fsPromises.writeFile(filepath, text, { encoding: "utf-8", flag: "wx" });
    } catch (error) {
        if (error?.code !== "EEXIST") {
            return { error: error?.message || "persist failed" };
        }
    }
    const { preview, hasMore } = generatePreview(text);
    return {
        filepath,
        originalSize: text.length,
        preview,
        hasMore,
    };
}

/**
 * Per-tool threshold: persist large results to disk and return a preview message.
 */
export async function maybePersistLargeToolResult(
    content,
    {
        toolName,
        toolUseId,
        maxResultSizeChars = DEFAULT_MAX_RESULT_SIZE_CHARS,
        sessionsDir,
        sessionId,
    },
) {
    const body = ensureNonEmptyToolContent(content, toolName);
    const threshold = resolveMaxResultSizeChars(maxResultSizeChars);
    if (threshold === Infinity || body.length <= threshold || !sessionsDir || !sessionId || !toolUseId) {
        return body;
    }
    const persisted = await persistToolResult(body, sessionsDir, sessionId, toolUseId);
    if (persisted.error) {
        return body;
    }
    return buildLargeToolResultMessage(persisted);
}

export function loadToolResultBudgetState(session) {
    const raw = session?.meta?.toolResultBudgetState;
    const seenIds = new Set(Array.isArray(raw?.seenIds) ? raw.seenIds : []);
    const replacements = new Map(
        raw?.replacements && typeof raw.replacements === "object"
            ? Object.entries(raw.replacements)
            : [],
    );
    return { seenIds, replacements };
}

export function serializeToolResultBudgetState(state) {
    return {
        seenIds: [...state.seenIds],
        replacements: Object.fromEntries(state.replacements),
    };
}

function contentSize(content) {
    return String(content || "").length;
}

function collectToolRoundGroups(messages) {
    const groups = [];
    let current = [];
    for (const message of messages || []) {
        if (message?.role === "tool" && message.toolCallId) {
            if (
                !isPersistedToolResultContent(message.content) &&
                !isToolResultContentEmpty(message.content)
            ) {
                current.push(message);
            }
        } else if (current.length) {
            groups.push(current);
            current = [];
        }
    }
    if (current.length) {
        groups.push(current);
    }
    return groups;
}

function partitionByPriorDecision(candidates, state) {
    const mustReapply = [];
    const frozen = [];
    const fresh = [];
    for (const candidate of candidates) {
        const replacement = state.replacements.get(candidate.toolCallId);
        if (replacement !== undefined) {
            mustReapply.push({ ...candidate, replacement });
        } else if (state.seenIds.has(candidate.toolCallId)) {
            frozen.push(candidate);
        } else {
            fresh.push(candidate);
        }
    }
    return { mustReapply, frozen, fresh };
}

function selectFreshToReplace(fresh, frozenSize, limit) {
    const sorted = [...fresh].sort((a, b) => contentSize(b.content) - contentSize(a.content));
    const selected = [];
    let remaining = frozenSize + fresh.reduce((sum, item) => sum + contentSize(item.content), 0);
    for (const candidate of sorted) {
        if (remaining <= limit) {
            break;
        }
        selected.push(candidate);
        remaining -= contentSize(candidate.content);
    }
    return selected;
}

function applyReplacementMap(messages, replacementMap) {
    if (!replacementMap.size) {
        return messages;
    }
    return messages.map((message) => {
        if (message.role !== "tool") {
            return message;
        }
        const replacement = replacementMap.get(message.toolCallId);
        if (replacement === undefined) {
            return message;
        }
        return { ...message, content: replacement };
    });
}

/**
 * Enforce per-round aggregate budget. Mutates `state` and returns updated messages.
 */
export async function enforceToolResultBudget(
    messages,
    state,
    {
        sessionsDir,
        sessionId,
        skipToolNames = new Set(),
        limit = MAX_TOOL_RESULTS_PER_ROUND_CHARS,
    } = {},
) {
    const replacementMap = new Map();
    const toPersist = [];

    for (const group of collectToolRoundGroups(messages)) {
        const eligible = group.filter((message) => !skipToolNames.has(message.name));
        const { mustReapply, frozen, fresh } = partitionByPriorDecision(eligible, state);

        for (const item of mustReapply) {
            replacementMap.set(item.toolCallId, item.replacement);
        }

        if (!fresh.length) {
            for (const item of group) {
                state.seenIds.add(item.toolCallId);
            }
            continue;
        }

        const skipped = fresh.filter((item) => skipToolNames.has(item.name));
        skipped.forEach((item) => state.seenIds.add(item.toolCallId));
        const freshEligible = fresh.filter((item) => !skipToolNames.has(item.name));
        const frozenSize = frozen.reduce((sum, item) => sum + contentSize(item.content), 0);
        const freshSize = freshEligible.reduce((sum, item) => sum + contentSize(item.content), 0);
        const selected =
            frozenSize + freshSize > limit
                ? selectFreshToReplace(freshEligible, frozenSize, limit)
                : [];

        const selectedIds = new Set(selected.map((item) => item.toolCallId));
        for (const item of group) {
            if (!selectedIds.has(item.toolCallId)) {
                state.seenIds.add(item.toolCallId);
            }
        }
        toPersist.push(...selected);
    }

    for (const candidate of toPersist) {
        const persisted = await persistToolResult(
            candidate.content,
            sessionsDir,
            sessionId,
            candidate.toolCallId,
        );
        state.seenIds.add(candidate.toolCallId);
        if (persisted.error) {
            continue;
        }
        const replacement = buildLargeToolResultMessage(persisted);
        replacementMap.set(candidate.toolCallId, replacement);
        state.replacements.set(candidate.toolCallId, replacement);
    }

    if (!replacementMap.size) {
        return { messages, changed: false, newlyReplaced: [] };
    }

    return {
        messages: applyReplacementMap(messages, replacementMap),
        changed: true,
        newlyReplaced: [...replacementMap.keys()],
    };
}

export async function finalizeToolResultForLlm(
    normalized,
    {
        toolName,
        toolUseId,
        maxResultSizeChars,
        sessionsDir,
        sessionId,
        hasImages = false,
    },
) {
    if (hasImages || normalized?.images?.length) {
        const content = ensureNonEmptyToolContent(normalized.content, toolName);
        return { ...normalized, content };
    }
    const content = await maybePersistLargeToolResult(normalized.content, {
        toolName,
        toolUseId,
        maxResultSizeChars,
        sessionsDir,
        sessionId,
    });
    return { ...normalized, content };
}

export function resolveToolMaxResultSizeChars(tool) {
    if (tool && Object.prototype.hasOwnProperty.call(tool, "maxResultSizeChars")) {
        return tool.maxResultSizeChars;
    }
    return DEFAULT_MAX_RESULT_SIZE_CHARS;
}
