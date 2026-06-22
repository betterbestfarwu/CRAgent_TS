import { shouldRequireNetworkConfirmation } from "../authPolicy.js";
import { DEFAULT_MAX_RESULT_SIZE_CHARS } from "@shared/toolLimits.js";
import { WEB_SEARCH_TOOL_NAME, webSearchSystemPromptSection } from "../webSearchPrompt.js";
import {
    executeWebSearch,
    isWebSearchAvailable,
    resolveWebSearchModel,
    validateWebSearchInput,
} from "../webSearchService.js";

function fnSchema(name, description, parameters) {
    return {
        type: "function",
        function: { name, description, parameters },
    };
}

export { webSearchSystemPromptSection };

export function createWebSearchTools({
    getAgentTools,
    getConfig,
    getSessionModel,
    confirmToolExecution,
    getAuthMode,
    resolveRequestTimeoutMs,
}) {
    function webSearchEnabled() {
        const tools = getAgentTools();
        if (tools.enable_tools === false || tools.enable_web_search !== true) {
            return false;
        }
        return true;
    }

    return [
        {
            name: WEB_SEARCH_TOOL_NAME,
            maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
            requiresConfirmation: false,
            enabled: () => webSearchEnabled(),
            enabledForSession: (sessionId) => {
                if (!webSearchEnabled()) {
                    return false;
                }
                const sessionModel =
                    typeof getSessionModel === "function" ? getSessionModel(sessionId) : null;
                return isWebSearchAvailable(
                    getConfig(),
                    sessionModel?.providerKey,
                    sessionModel?.modelId,
                );
            },
            schema: fnSchema(
                WEB_SEARCH_TOOL_NAME,
                "Search the web for current information. Returns summarized results with source links.",
                {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "The search query to use",
                            minLength: 2,
                        },
                        allowed_domains: {
                            type: "array",
                            items: { type: "string" },
                            description: "Only include search results from these domains",
                        },
                        blocked_domains: {
                            type: "array",
                            items: { type: "string" },
                            description: "Never include search results from these domains",
                        },
                    },
                    required: ["query"],
                },
            ),
            async execute(args, context) {
                const validation = validateWebSearchInput(args);
                if (!validation.ok) {
                    throw new Error(validation.message);
                }

                const sessionModel =
                    typeof getSessionModel === "function"
                        ? getSessionModel(context?.sessionId)
                        : null;
                const modelRef = resolveWebSearchModel(
                    getConfig(),
                    sessionModel?.providerKey,
                    sessionModel?.modelId,
                );
                if (!modelRef) {
                    throw new Error(
                        "Web search requires a configured Anthropic provider with a supported Claude 4 model (claude-opus-4, claude-sonnet-4, or claude-haiku-4).",
                    );
                }

                const provider = getConfig()?.models?.[modelRef.providerKey];
                if (!provider?.apiKey || String(provider.apiKey).includes("REPLACE_ME")) {
                    throw new Error("请先在设置中配置有效的 Anthropic API Key 后再使用 web_search。");
                }

                const summary = `搜索网页:\n${validation.query}`;
                if (shouldRequireNetworkConfirmation(() => getAuthMode(context?.sessionId))) {
                    const approved = await confirmToolExecution(WEB_SEARCH_TOOL_NAME, summary);
                    if (!approved) {
                        throw new Error("user declined: web_search");
                    }
                }

                return executeWebSearch({
                    query: validation.query,
                    allowed_domains: args.allowed_domains,
                    blocked_domains: args.blocked_domains,
                    provider,
                    modelId: modelRef.modelId,
                    signal: context?.signal,
                    timeoutMs:
                        typeof resolveRequestTimeoutMs === "function"
                            ? resolveRequestTimeoutMs()
                            : undefined,
                });
            },
        },
    ];
}
