import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DEFAULT_LLM_REQUEST_TIMEOUT_MS,
    LlmClient,
    buildLlmRequestUrl,
    createLlmRequestSignal,
    parseAssistantChoice,
} from "../src/main/llmClient.js";

describe("parseAssistantChoice", () => {
    it("uses reasoning_content when content is empty", () => {
        const parsed = parseAssistantChoice({
            role: "assistant",
            content: "",
            reasoning_content: "Let me think step by step.",
        });

        assert.equal(parsed.content, "");
        assert.equal(parsed.reasoningContent, "Let me think step by step.");
        assert.equal(parsed.useReasoningAsContent, true);
    });

    it("keeps reasoning_content separate when both fields are present", () => {
        const parsed = parseAssistantChoice({
            role: "assistant",
            content: "Final answer",
            reasoning_content: "Hidden reasoning",
        });

        assert.equal(parsed.content, "Final answer");
        assert.equal(parsed.reasoningContent, "Hidden reasoning");
        assert.equal(parsed.useReasoningAsContent, false);
    });

    it("does not fall back to reasoning when tool calls are present", () => {
        const parsed = parseAssistantChoice({
            role: "assistant",
            content: "",
            reasoning_content: "Planning tool use",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file" } }],
        });

        assert.equal(parsed.reasoningContent, "Planning tool use");
        assert.equal(parsed.useReasoningAsContent, false);
    });
});

describe("buildLlmRequestUrl", () => {
    it("joins baseUrl and api path without duplicate slashes", () => {
        assert.equal(
            buildLlmRequestUrl({
                baseUrl: "https://integrate.api.nvidia.com/v1/",
                api: "chat/completions",
            }),
            "https://integrate.api.nvidia.com/v1/chat/completions",
        );
    });
});

describe("createLlmRequestSignal", () => {
    it("aborts after the configured timeout", async () => {
        const { signal, didTimeout, cleanup } = createLlmRequestSignal(undefined, 30);
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 200);
                signal.addEventListener(
                    "abort",
                    () => {
                        clearTimeout(timer);
                        reject(signal.reason || new Error("aborted"));
                    },
                    { once: true },
                );
            });
            assert.fail("expected timeout abort");
        } catch (error) {
            assert.equal(didTimeout(), true);
            assert.match(String(error.message || error), /模型请求超时/);
        } finally {
            cleanup();
        }
    });
});

describe("LlmClient", () => {
    it("stores reasoningContent on assistant messages", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () =>
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                role: "assistant",
                                content: "Done",
                                reasoning_content: "Worked through the problem.",
                            },
                        },
                    ],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            );

        try {
            const client = new LlmClient(() => ({
                baseUrl: "https://api.example.com/v1",
                apiKey: "sk-test",
                api: "chat/completions",
            }));
            const result = await client.chat({
                model: { providerKey: "openai", modelId: "glm-5.1" },
                messages: [{ role: "user", content: "hello" }],
            });
            assert.equal(result.message.content, "Done");
            assert.equal(result.message.reasoningContent, "Worked through the problem.");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("falls back to reasoning_content when content is empty", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () =>
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                role: "assistant",
                                content: "",
                                reasoning_content: "Only reasoning was returned.",
                            },
                        },
                    ],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            );

        try {
            const client = new LlmClient(() => ({
                baseUrl: "https://api.example.com/v1",
                apiKey: "sk-test",
                api: "chat/completions",
            }));
            const result = await client.complete({
                model: { providerKey: "openai", modelId: "glm-5.1" },
                messages: [{ role: "user", content: "hello" }],
            });
            assert.equal(result.message.content, "Only reasoning was returned.");
            assert.equal(result.message.reasoningContent, undefined);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("throws a timeout error when the request stalls", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (_url, init) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener("abort", () => {
                    const error = new Error("aborted");
                    error.name = "AbortError";
                    reject(error);
                });
            });

        try {
            const client = new LlmClient(
                () => ({
                    baseUrl: "https://api.example.com/v1",
                    apiKey: "sk-test",
                    api: "chat/completions",
                }),
                { requestTimeoutMs: 30 },
            );
            await assert.rejects(
                () =>
                    client.chatOnce({
                        model: { providerKey: "openai", modelId: "slow-model" },
                        messages: [{ role: "user", content: "hello" }],
                    }),
                /模型请求超时/,
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("defaults request timeout to five minutes", () => {
        const client = new LlmClient(() => ({}));
        assert.equal(client.requestTimeoutMs, DEFAULT_LLM_REQUEST_TIMEOUT_MS);
        assert.equal(DEFAULT_LLM_REQUEST_TIMEOUT_MS, 300_000);
    });

    it("reads request timeout from config resolver on each request", () => {
        const client = new LlmClient(
            () => ({}),
            { resolveRequestTimeoutMs: () => 90_000 },
        );
        assert.equal(client.getRequestTimeoutMs(), 90_000);
    });

    it("sends temperature in chat request body", async () => {
        const originalFetch = globalThis.fetch;
        let capturedBody = null;
        globalThis.fetch = async (_url, init) => {
            capturedBody = JSON.parse(init.body);
            return new Response(
                JSON.stringify({
                    choices: [{ message: { role: "assistant", content: "ok" } }],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            );
        };

        try {
            const client = new LlmClient(
                () => ({
                    baseUrl: "https://api.example.com/v1",
                    apiKey: "sk-test",
                    api: "chat/completions",
                }),
                { resolveTemperature: () => 0.3 },
            );
            await client.chat({
                model: { providerKey: "openai", modelId: "gpt-4" },
                messages: [{ role: "user", content: "hello" }],
            });
            assert.equal(capturedBody.temperature, 0.3);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
