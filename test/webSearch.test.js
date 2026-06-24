import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolRegistry } from "../src/main/toolRegistry.js";
import { createBuiltinTools } from "../src/main/tools/builtinTools.js";
import { createWebSearchTools } from "../src/main/tools/webSearchTools.js";
import {
    formatWebSearchToolResult,
    isWebSearchAvailable,
    makeOutputFromSearchResponse,
    modelSupportsWebSearch,
    resolveWebSearchModel,
    validateWebSearchInput,
} from "../src/main/webSearchService.js";
import { WEB_SEARCH_TOOL_NAME } from "../src/main/webSearchPrompt.js";

function sampleConfig(overrides = {}) {
    return {
        models: {
            anthropic: {
                baseUrl: "https://api.anthropic.com/v1",
                apiKey: "sk-anthropic",
                api: "messages",
                state: true,
                models: [{ id: "claude-opus-4-5", state: true }],
            },
            openai: {
                baseUrl: "https://api.openai.com/v1",
                apiKey: "sk-openai",
                api: "chat/completions",
                state: true,
                models: [{ id: "gpt-4o-mini", state: true }],
            },
        },
        agents: {
            default: {
                model: { primary: "openai/gpt-4o-mini", fallbacks: [] },
            },
        },
        ...overrides,
    };
}

describe("webSearchService", () => {
    it("detects supported Claude 4 models", () => {
        assert.equal(modelSupportsWebSearch("claude-opus-4-5"), true);
        assert.equal(modelSupportsWebSearch("claude-sonnet-4-20250514"), true);
        assert.equal(modelSupportsWebSearch("gpt-4o-mini"), false);
    });

    it("validates input and rejects conflicting domain filters", () => {
        assert.deepEqual(validateWebSearchInput({ query: "a" }), {
            ok: false,
            message: "Error: Query must be at least 2 characters",
        });
        assert.deepEqual(validateWebSearchInput({ query: "weather NYC" }), {
            ok: true,
            query: "weather NYC",
        });
        assert.equal(
            validateWebSearchInput({
                query: "docs",
                allowed_domains: ["example.com"],
                blocked_domains: ["bad.com"],
            }).ok,
            false,
        );
    });

    it("parses Anthropic web search content blocks", () => {
        const output = makeOutputFromSearchResponse(
            [
                { type: "text", text: "Summary intro" },
                { type: "server_tool_use", id: "su_1", name: "web_search" },
                {
                    type: "web_search_tool_result",
                    tool_use_id: "su_1",
                    content: [{ title: "Example", url: "https://example.com" }],
                },
                { type: "text", text: "More context" },
            ],
            "weather NYC",
            1.2,
        );

        assert.equal(output.query, "weather NYC");
        assert.equal(output.durationSeconds, 1.2);
        assert.equal(output.results[0], "Summary intro");
        assert.deepEqual(output.results[1], {
            tool_use_id: "su_1",
            content: [{ title: "Example", url: "https://example.com" }],
        });
        assert.equal(output.results[2], "More context");
    });

    it("formats tool results with source reminder", () => {
        const text = formatWebSearchToolResult({
            query: "weather NYC",
            results: [
                "It is sunny.",
                {
                    tool_use_id: "su_1",
                    content: [{ title: "Weather", url: "https://weather.example" }],
                },
            ],
        });
        assert.match(text, /Web search results for query: "weather NYC"/);
        assert.match(text, /Links: \[{"title":"Weather","url":"https:\/\/weather.example"}\]/);
        assert.match(text, /markdown hyperlinks/);
    });

    it("resolves anthropic model even when session uses openai", () => {
        const config = sampleConfig();
        const resolved = resolveWebSearchModel(config, "openai", "gpt-4o-mini");
        assert.deepEqual(resolved, { providerKey: "anthropic", modelId: "claude-opus-4-5" });
        assert.equal(isWebSearchAvailable(config, "openai", "gpt-4o-mini"), true);
    });
});

describe("webSearchTools", () => {
    it("registers web_search only when enabled and anthropic is configured", () => {
        const config = sampleConfig();
        const registry = new ToolRegistry(() =>
            createWebSearchTools({
                getAgentTools: () => ({ enable_tools: true, enable_web_search: true }),
                getConfig: () => config,
                getSessionModel: () => ({ providerKey: "openai", modelId: "gpt-4o-mini" }),
                confirmToolExecution: async () => true,
                getAuthMode: () => "fullAccess",
            }),
        );

        const active = registry.activeTools("session-1");
        assert.equal(active.some((tool) => tool.name === WEB_SEARCH_TOOL_NAME), true);

        const disabled = new ToolRegistry(() =>
            createWebSearchTools({
                getAgentTools: () => ({ enable_tools: true, enable_web_search: false }),
                getConfig: () => config,
                getSessionModel: () => ({ providerKey: "openai", modelId: "gpt-4o-mini" }),
                confirmToolExecution: async () => true,
                getAuthMode: () => "fullAccess",
            }),
        ).activeTools("session-1");
        assert.equal(disabled.some((tool) => tool.name === WEB_SEARCH_TOOL_NAME), false);
    });
});

describe("web_fetch", () => {
    it("fails quickly when the fetch request exceeds the configured timeout", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (_url, init = {}) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener("abort", () => {
                    reject(new Error("aborted by test signal"));
                });
            });

        try {
            const [webFetch] = createBuiltinTools({
                getAgentWorkspace: () => process.cwd(),
                getDefaultWorkspace: () => process.cwd(),
                workspaceMemory: { resolveMemoryPath: () => "", listSearchableMemoryFiles: () => [] },
                skillLoader: { loadFullText: () => "" },
                getAgentTools: () => ({ enable_tools: true, enable_file_tools: false }),
                confirmToolExecution: async () => true,
                getAuthMode: () => "fullAccess",
                getShellRuntime: () => null,
            }).filter((tool) => tool.name === "web_fetch");

            await assert.rejects(
                webFetch.execute(
                    { url: "https://example.com/hangs" },
                    { webFetchTimeoutMs: 20 },
                ),
                /web_fetch timed out after 20ms|aborted by test signal/,
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
