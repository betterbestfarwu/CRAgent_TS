import { parseModelRef } from "@shared/modelRef.js";
import { resolvePrimaryModelRef } from "@shared/modelsConfig.js";
import { DEFAULT_LLM_REQUEST_TIMEOUT_MS } from "./llmClient.js";

const WEB_SEARCH_MAX_USES = 8;
const ANTHROPIC_VERSION = "2023-06-01";

export function modelSupportsWebSearch(modelId) {
    const id = String(modelId || "").toLowerCase();
    return (
        id.includes("claude-opus-4") ||
        id.includes("claude-sonnet-4") ||
        id.includes("claude-haiku-4")
    );
}

function isProviderConfigured(provider) {
    return Boolean(provider?.apiKey && !String(provider.apiKey).includes("REPLACE_ME") && provider.state !== false);
}

export function findAnthropicProviders(config) {
    const providers = [];
    for (const [providerKey, provider] of Object.entries(config?.models || {})) {
        if (!isProviderConfigured(provider)) {
            continue;
        }
        const baseUrl = String(provider.baseUrl || "").toLowerCase();
        const looksAnthropic =
            providerKey.toLowerCase().includes("anthropic") ||
            baseUrl.includes("anthropic.com") ||
            String(provider.api || "").toLowerCase() === "messages";
        if (!looksAnthropic) {
            continue;
        }
        providers.push({ providerKey, provider });
    }
    return providers;
}

export function resolveWebSearchModel(config, sessionProviderKey, sessionModelId) {
    const candidates = [];
    const seen = new Set();

    function pushCandidate(providerKey, modelId) {
        if (!providerKey || !modelId || !modelSupportsWebSearch(modelId)) {
            return;
        }
        const key = `${providerKey}/${modelId}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        candidates.push({ providerKey, modelId });
    }

    pushCandidate(sessionProviderKey, sessionModelId);

    const primaryRef = parseModelRef(
        resolvePrimaryModelRef(config?.models, config?.agents?.default?.model?.primary),
    );
    if (primaryRef) {
        pushCandidate(primaryRef.providerKey, primaryRef.modelId);
    }

    for (const { providerKey, provider } of findAnthropicProviders(config)) {
        for (const model of provider.models || []) {
            if (model?.state === false) {
                continue;
            }
            pushCandidate(providerKey, model.id);
        }
    }

    return candidates[0] || null;
}

export function isWebSearchAvailable(config, sessionProviderKey, sessionModelId) {
    const model = resolveWebSearchModel(config, sessionProviderKey, sessionModelId);
    if (!model) {
        return false;
    }
    const provider = config?.models?.[model.providerKey];
    return isProviderConfigured(provider);
}

export function validateWebSearchInput(input) {
    const query = String(input?.query || "").trim();
    if (!query) {
        return { ok: false, message: "Error: Missing query" };
    }
    if (query.length < 2) {
        return { ok: false, message: "Error: Query must be at least 2 characters" };
    }
    const allowed = input?.allowed_domains;
    const blocked = input?.blocked_domains;
    if (Array.isArray(allowed) && allowed.length && Array.isArray(blocked) && blocked.length) {
        return {
            ok: false,
            message:
                "Error: Cannot specify both allowed_domains and blocked_domains in the same request",
        };
    }
    return { ok: true, query };
}

function buildAnthropicMessagesUrl(provider) {
    const baseUrl = String(provider?.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
    return `${baseUrl}/messages`;
}

function buildAnthropicHeaders(provider) {
    return {
        "Content-Type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        "x-api-key": provider.apiKey,
    };
}

function makeToolSchema(input) {
    const schema = {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: WEB_SEARCH_MAX_USES,
    };
    if (Array.isArray(input.allowed_domains) && input.allowed_domains.length) {
        schema.allowed_domains = input.allowed_domains.map(String);
    }
    if (Array.isArray(input.blocked_domains) && input.blocked_domains.length) {
        schema.blocked_domains = input.blocked_domains.map(String);
    }
    return schema;
}

export function makeOutputFromSearchResponse(contentBlocks, query, durationSeconds) {
    const results = [];
    let textAcc = "";
    let inText = true;

    for (const block of contentBlocks || []) {
        if (block?.type === "server_tool_use") {
            if (inText) {
                inText = false;
                if (textAcc.trim().length > 0) {
                    results.push(textAcc.trim());
                }
                textAcc = "";
            }
            continue;
        }

        if (block?.type === "web_search_tool_result") {
            if (!Array.isArray(block.content)) {
                results.push(`Web search error: ${block.content?.error_code || "unknown_error"}`);
                continue;
            }
            const hits = block.content.map((entry) => ({
                title: entry.title,
                url: entry.url,
            }));
            results.push({
                tool_use_id: block.tool_use_id,
                content: hits,
            });
            continue;
        }

        if (block?.type === "text") {
            if (inText) {
                textAcc += block.text || "";
            } else {
                inText = true;
                textAcc = block.text || "";
            }
        }
    }

    if (textAcc.length) {
        results.push(textAcc.trim());
    }

    return {
        query,
        results,
        durationSeconds,
    };
}

export function formatWebSearchToolResult(output) {
    const { query, results } = output;
    let formattedOutput = `Web search results for query: "${query}"\n\n`;

    for (const result of results ?? []) {
        if (result == null) {
            continue;
        }
        if (typeof result === "string") {
            formattedOutput += `${result}\n\n`;
            continue;
        }
        if (result.content?.length > 0) {
            formattedOutput += `Links: ${JSON.stringify(result.content)}\n\n`;
        } else {
            formattedOutput += "No links found.\n\n";
        }
    }

    formattedOutput +=
        "\nREMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.";
    return formattedOutput.trim();
}

export async function executeWebSearch({
    query,
    allowed_domains,
    blocked_domains,
    provider,
    modelId,
    signal,
    timeoutMs = DEFAULT_LLM_REQUEST_TIMEOUT_MS,
}) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) {
        controller.abort(signal.reason);
    } else if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
    }

    let timeoutId = null;
    if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
            controller.abort(new Error(`Web search timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
    }

    try {
        const response = await fetch(buildAnthropicMessagesUrl(provider), {
            method: "POST",
            headers: buildAnthropicHeaders(provider),
            body: JSON.stringify({
                model: modelId,
                max_tokens: 4096,
                messages: [
                    {
                        role: "user",
                        content: `Perform a web search for the query: ${query}`,
                    },
                ],
                tools: [makeToolSchema({ allowed_domains, blocked_domains })],
            }),
            signal: controller.signal,
        });

        const bodyText = await response.text();
        if (!response.ok) {
            throw new Error(`Web search API error: ${response.status} ${bodyText.slice(0, 300)}`);
        }

        let data;
        try {
            data = JSON.parse(bodyText);
        } catch {
            throw new Error("Web search API returned invalid JSON");
        }

        const durationSeconds = (Date.now() - startedAt) / 1000;
        const output = makeOutputFromSearchResponse(data.content, query, durationSeconds);
        return formatWebSearchToolResult(output);
    } finally {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
        if (signal) {
            signal.removeEventListener("abort", onAbort);
        }
    }
}
