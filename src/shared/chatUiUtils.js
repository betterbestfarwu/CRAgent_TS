/** Shared chat UI helpers (task list + thinking summary). Bundled to public/chat/chatUiUtils.js for iframe. */

const READ_TOOLS = new Set(["read_file", "memory_get"]);
const LIST_TOOLS = new Set(["list_dir"]);
const SEARCH_TOOLS = new Set(["memory_search"]);
const SHELL_TOOLS = new Set(["bash"]);
const WEB_TOOLS = new Set(["web_fetch", "web_search"]);
const WRITE_TOOLS = new Set(["write_file"]);

/** Tools whose parallel uses in one assistant turn can collapse in the thinking UI. */
export const GROUPABLE_TOOLS = new Set([
    ...READ_TOOLS,
    ...LIST_TOOLS,
    ...SEARCH_TOOLS,
    ...SHELL_TOOLS,
    ...WEB_TOOLS,
    ...WRITE_TOOLS,
]);

const TODO_STATUS_RANK = {
    in_progress: 0,
    pending: 1,
    completed: 2,
};

export const MAX_TODO_INLINE_DISPLAY = 12;

export function parseToolArguments(raw) {
    if (raw == null || raw === "") {
        return {};
    }
    if (typeof raw === "object") {
        return raw;
    }
    try {
        return JSON.parse(String(raw));
    } catch {
        return {};
    }
}

function categorizeToolName(name) {
    if (READ_TOOLS.has(name)) {
        return "read";
    }
    if (LIST_TOOLS.has(name)) {
        return "list";
    }
    if (SEARCH_TOOLS.has(name)) {
        return "search";
    }
    if (SHELL_TOOLS.has(name)) {
        return "shell";
    }
    if (WEB_TOOLS.has(name)) {
        return "web";
    }
    if (WRITE_TOOLS.has(name)) {
        return "write";
    }
    return "other";
}

function collectToolCallsFromMessage(msg) {
    if (msg?.role !== "assistant" || !msg.tool_calls?.length) {
        return [];
    }
    return msg.tool_calls.map((call) => ({
        id: call.id ? String(call.id) : "",
        name: call.name || "tool",
        arguments: call.arguments ?? "",
    }));
}

function isProcessAssistantWithTools(msg) {
    return msg?.role === "assistant" && Boolean(msg.tool_calls?.length);
}

function assistantVisibleText(msg) {
    return (
        String(msg?.content || "").trim() ||
        String(msg?.reasoningContent || msg?.reasoning_content || "").trim()
    );
}

function hasVisibleAssistantContent(msg) {
    return msg?.role === "assistant" && Boolean(assistantVisibleText(msg));
}

function recordToolCallStats(call, stats) {
    const category = categorizeToolName(call.name);
    if (category === "read") {
        stats.read += 1;
        const args = parseToolArguments(call.arguments);
        const filePath = args.path || args.file_path || args.filePath;
        if (filePath) {
            stats.readPaths.add(String(filePath));
        }
    } else if (category === "list") {
        stats.list += 1;
    } else if (category === "search") {
        stats.search += 1;
    } else if (category === "shell") {
        stats.shell += 1;
    } else if (category === "web") {
        stats.web += 1;
    } else if (category === "write") {
        stats.write += 1;
    } else {
        stats.other += 1;
    }
}

function groupCallsInAssistantMessage(calls, verbose) {
    if (verbose || calls.length < 2) {
        return calls.map((call) => ({ type: "single", call }));
    }

    const segments = [];
    let index = 0;
    while (index < calls.length) {
        const call = calls[index];
        if (!GROUPABLE_TOOLS.has(call.name)) {
            segments.push({ type: "single", call });
            index += 1;
            continue;
        }
        let end = index + 1;
        while (
            end < calls.length &&
            calls[end].name === call.name &&
            GROUPABLE_TOOLS.has(calls[end].name)
        ) {
            end += 1;
        }
        const slice = calls.slice(index, end);
        if (slice.length >= 2) {
            segments.push({ type: "group", name: call.name, calls: slice });
        } else {
            segments.push({ type: "single", call: slice[0] });
        }
        index = end;
    }
    return segments;
}

function cloneThinkingItem(item) {
    if (item.kind === "tool-call-group") {
        return { kind: "tool-call-group", name: item.name, calls: [...item.calls] };
    }
    if (item.kind === "tool-result-group") {
        return { kind: "tool-result-group", name: item.name, results: [...item.results] };
    }
    return { ...item };
}

/** Merge neighboring groups of the same tool (cross assistant turn). */
export function collapseAdjacentThinkingItems(items, verbose) {
    if (verbose || !items?.length) {
        return items || [];
    }

    const collapsed = [];
    for (const item of items) {
        const previous = collapsed[collapsed.length - 1];
        if (
            item.kind === "tool-call-group" &&
            previous?.kind === "tool-call-group" &&
            previous.name === item.name
        ) {
            previous.calls.push(...item.calls);
            continue;
        }
        if (
            item.kind === "tool-result-group" &&
            previous?.kind === "tool-result-group" &&
            previous.name === item.name
        ) {
            previous.results.push(...item.results);
            continue;
        }
        collapsed.push(cloneThinkingItem(item));
    }
    return collapsed;
}

function createResultCollector(verbose) {
    const openGroups = [];
    let pendingConsecutive = null;

    function flushConsecutive(items) {
        if (!pendingConsecutive) {
            return;
        }
        const { name, contents } = pendingConsecutive;
        if (!verbose && contents.length >= 2 && GROUPABLE_TOOLS.has(name)) {
            items.push({
                kind: "tool-result-group",
                name,
                results: contents,
            });
        } else {
            for (const content of contents) {
                items.push({
                    kind: "tool-result",
                    name,
                    content,
                });
            }
        }
        pendingConsecutive = null;
    }

    return {
        registerOpenGroup(name, calls) {
            const expectedIds = new Set(calls.map((call) => call.id).filter(Boolean));
            if (expectedIds.size >= 2) {
                openGroups.push({
                    name,
                    expectedIds,
                    results: new Map(),
                    calls,
                });
            }
        },
        addToolResult(items, msg) {
            const toolCallId = msg.tool_call_id ? String(msg.tool_call_id) : "";
            const name = msg.name || "";
            const content = msg.content || "";

            for (let index = 0; index < openGroups.length; index += 1) {
                const group = openGroups[index];
                if (!toolCallId || !group.expectedIds.has(toolCallId)) {
                    continue;
                }
                group.results.set(toolCallId, content);
                if (group.results.size !== group.expectedIds.size) {
                    return;
                }
                openGroups.splice(index, 1);
                items.push({
                    kind: "tool-result-group",
                    name: group.name,
                    results: group.calls.map((call) => group.results.get(call.id) || ""),
                });
                flushConsecutive(items);
                return;
            }

            if (
                !verbose &&
                pendingConsecutive &&
                pendingConsecutive.name === name &&
                GROUPABLE_TOOLS.has(name)
            ) {
                pendingConsecutive.contents.push(content);
                return;
            }
            flushConsecutive(items);
            pendingConsecutive = { name, contents: [content] };
        },
        flush(items) {
            flushConsecutive(items);
            for (const group of openGroups) {
                if (group.results.size === 0) {
                    continue;
                }
                const collected = group.calls.map((call) => group.results.get(call.id) || "");
                if (!verbose && collected.length >= 2 && GROUPABLE_TOOLS.has(group.name)) {
                    items.push({
                        kind: "tool-result-group",
                        name: group.name,
                        results: collected,
                    });
                } else {
                    for (let index = 0; index < group.calls.length; index += 1) {
                        items.push({
                            kind: "tool-result",
                            name: group.name,
                            content: collected[index] || "",
                        });
                    }
                }
            }
            openGroups.length = 0;
        },
    };
}

/**
 * Build collapsible thinking summary + step items from run messages (pre-final reply).
 * @param {Array<{ id: string, role: string, content?: string, name?: string, tool_calls?: Array, tool_call_id?: string }>} thinkingMessages
 * @param {{ verbose?: boolean }} [options]
 */
export function buildThinkingSummary(thinkingMessages, options = {}) {
    const verbose = Boolean(options.verbose);
    const items = [];
    const ids = [];
    const stats = {
        read: 0,
        readPaths: new Set(),
        list: 0,
        search: 0,
        shell: 0,
        web: 0,
        write: 0,
        other: 0,
        assistantText: 0,
    };
    const resultCollector = createResultCollector(verbose);

    for (const msg of thinkingMessages || []) {
        if (msg?.id) {
            ids.push(msg.id);
        }

        if (hasVisibleAssistantContent(msg) && isProcessAssistantWithTools(msg)) {
            stats.assistantText += 1;
            items.push({
                kind: "assistant-text",
                content:
                    msg.content ||
                    msg.reasoningContent ||
                    msg.reasoning_content ||
                    "",
            });
        }

        if (msg?.role === "tool") {
            resultCollector.addToolResult(items, msg);
            continue;
        }

        const calls = collectToolCallsFromMessage(msg);
        if (!calls.length) {
            continue;
        }

        const segments = groupCallsInAssistantMessage(calls, verbose);
        for (const segment of segments) {
            if (segment.type === "group") {
                for (const call of segment.calls) {
                    recordToolCallStats(call, stats);
                }
                items.push({
                    kind: "tool-call-group",
                    name: segment.name,
                    calls: segment.calls,
                });
                resultCollector.registerOpenGroup(segment.name, segment.calls);
            } else {
                recordToolCallStats(segment.call, stats);
                items.push({
                    kind: "tool-call",
                    name: segment.call.name,
                    arguments: segment.call.arguments,
                });
            }
        }
    }

    resultCollector.flush(items);

    const displayItems = collapseAdjacentThinkingItems(items, verbose);
    const stepCount = displayItems.length;
    const summaryLine = formatThinkingSummaryLine(stats, stepCount);

    return { summaryLine, items: displayItems, ids, stepCount };
}

export function formatThinkingSummaryLine(stats, stepCount) {
    const parts = [];

    if (stats.read > 0) {
        const unique = stats.readPaths.size;
        if (unique > 0 && unique < stats.read) {
            parts.push(`Read ${stats.read} files (${unique} unique)`);
        } else {
            parts.push(`Read ${stats.read} file${stats.read === 1 ? "" : "s"}`);
        }
    }
    if (stats.list > 0) {
        parts.push(`Listed ${stats.list} ${stats.list === 1 ? "directory" : "directories"}`);
    }
    if (stats.search > 0) {
        parts.push(`${stats.search} search${stats.search === 1 ? "" : "es"}`);
    }
    if (stats.shell > 0) {
        parts.push(`Ran ${stats.shell} command${stats.shell === 1 ? "" : "s"}`);
    }
    if (stats.web > 0) {
        parts.push(`Fetched ${stats.web} URL${stats.web === 1 ? "" : "s"}`);
    }
    if (stats.write > 0) {
        parts.push(`Wrote ${stats.write} file${stats.write === 1 ? "" : "s"}`);
    }
    if (stats.other > 0) {
        parts.push(`${stats.other} other step${stats.other === 1 ? "" : "s"}`);
    }
    if (stats.assistantText > 0) {
        parts.push(`${stats.assistantText} note${stats.assistantText === 1 ? "" : "s"}`);
    }

    if (!parts.length) {
        return `Thinking · ${stepCount} step${stepCount === 1 ? "" : "s"}`;
    }

    return `Thinking · ${parts.join(" · ")} (${stepCount} step${stepCount === 1 ? "" : "s"})`;
}

export function sortTodosForDisplay(todos) {
    return [...(todos || [])]
        .filter((item) => item.status !== "cancelled")
        .sort((a, b) => {
            const rankA = TODO_STATUS_RANK[a.status] ?? 9;
            const rankB = TODO_STATUS_RANK[b.status] ?? 9;
            if (rankA !== rankB) {
                return rankA - rankB;
            }
            return String(a.id).localeCompare(String(b.id));
        });
}

export function todoDisplayLabel(item) {
    if (!item) {
        return "";
    }
    if (item.status === "in_progress") {
        const activeForm = String(item.activeForm || "").trim();
        if (activeForm) {
            return activeForm;
        }
    }
    return String(item.content || "").trim();
}

export function getCurrentInProgressTodo(todos) {
    return sortTodosForDisplay(todos).find((item) => item.status === "in_progress") || null;
}
