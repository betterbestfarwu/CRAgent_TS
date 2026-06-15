import { parseMcpToolRegistryName } from "@shared/mcpConfig.js";

export const TOOL_SEARCH_THRESHOLD = 20;

/** Built-in desktop control tools; always visible when enabled and catalog uses tool search. */
export const COMPUTER_USE_TOOL_NAMES = [
    "computer_action",
    "computer_displays",
    "computer_screenshot",
    "computer_move",
    "computer_click",
    "computer_type",
    "computer_key",
    "computer_scroll",
];

/** Always exposed when the catalog exceeds {@link TOOL_SEARCH_THRESHOLD}. */
export const PINNED_TOOL_NAMES = new Set([
    "read_file",
    "write_file",
    "list_dir",
    "bash",
    "web_fetch",
    "memory_get",
    "memory_search",
    "load_skill",
    "download_skill",
    "delete_skill",
    "TodoWrite",
    "Task",
    "tool_search",
    ...COMPUTER_USE_TOOL_NAMES,
]);

export function shouldUseToolSearch(activeToolCount) {
    return activeToolCount > TOOL_SEARCH_THRESHOLD;
}

export function isDeferredTool(name) {
    return parseMcpToolRegistryName(name) !== null;
}

function toolSearchSchema() {
    return {
        type: "function",
        function: {
            name: "tool_search",
            description:
                "Search deferred tools that are not in the visible tool list, usually MCP tools. " +
                "Matched tools stay enabled for the rest of this run. " +
                "Call this before using a hidden tool.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "Keywords for the capability, tool name, or server id you need",
                    },
                    limit: {
                        type: "integer",
                        description: "Maximum matches to return and enable (default 8)",
                    },
                },
                required: ["query"],
            },
        },
    };
}

function scoreTool(tool, queryTokens) {
    const name = tool.name.toLowerCase();
    const description = String(tool.schema?.function?.description || "").toLowerCase();
    const haystack = `${name} ${description}`;
    let score = 0;
    for (const token of queryTokens) {
        if (!token) {
            continue;
        }
        if (name === token) {
            score += 12;
        } else if (name.includes(token)) {
            score += 6;
        } else if (haystack.includes(token)) {
            score += 2;
        }
    }
    return score;
}

export function searchDeferredTools(tools, query, limit = 8) {
    const queryTokens = String(query || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter(Boolean);
    if (!queryTokens.length) {
        return [];
    }
    const cap = Math.max(1, Math.min(Number(limit) || 8, 20));
    return tools
        .filter((tool) => isDeferredTool(tool.name))
        .map((tool) => ({ tool, score: scoreTool(tool, queryTokens) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
        .slice(0, cap)
        .map((entry) => entry.tool);
}

export function formatToolSearchResult(matches, unlockedNames) {
    if (!matches.length) {
        return "No matching deferred tools. Try different keywords (server id, tool name, or capability).";
    }
    const lines = matches.map((tool) => {
        const description = tool.schema?.function?.description || "";
        return `- ${tool.name}: ${description}`;
    });
    const enabled = [...unlockedNames].sort().join(", ");
    return (
        `Enabled ${matches.length} tool(s) for this run:\n${lines.join("\n")}\n\n` +
        `All enabled deferred tools: ${enabled || "(none)"}`
    );
}

export function executeToolSearch(args, activeTools, unlockedToolNames) {
    const query = String(args?.query || "").trim();
    if (!query) {
        return "Error: 'query' is required";
    }
    const matches = searchDeferredTools(activeTools, query, args?.limit);
    for (const tool of matches) {
        unlockedToolNames.add(tool.name);
    }
    return formatToolSearchResult(matches, unlockedToolNames);
}

/**
 * @param {Array<{ name: string, schema: object, enabled: () => boolean }>} tools
 * @param {{ unlockedToolNames?: Set<string> }} [options]
 */
export function schemasForToolCatalog(tools, options = {}) {
    const active = tools.filter((tool) => tool.enabled()).sort((a, b) => a.name.localeCompare(b.name));
    if (!shouldUseToolSearch(active.length)) {
        return active.map((tool) => tool.schema);
    }

    const unlocked = options.unlockedToolNames || new Set();
    const visible = active.filter(
        (tool) => PINNED_TOOL_NAMES.has(tool.name) || unlocked.has(tool.name),
    );
    const hasSearch = visible.some((tool) => tool.name === "tool_search");
    const schemas = visible.map((tool) => tool.schema);
    if (!hasSearch) {
        schemas.push(toolSearchSchema());
    }
    return schemas.sort((a, b) => a.function.name.localeCompare(b.function.name));
}
