import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigStore } from "../src/main/configStore.js";
import { LlmClient } from "../src/main/llmClient.js";

test("ConfigStore.recordModelTokenUsage accumulates usage into model cost", () => {
    const configFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cragent-cost-")), "config.json");
    const store = new ConfigStore(configFile);
    store.recordModelTokenUsage("openai", "gpt-4o-mini", {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
    });
    store.recordModelTokenUsage("openai", "gpt-4o-mini", {
        prompt_tokens: 20,
        completion_tokens: 8,
        total_tokens: 28,
    });

    const model = store.model("openai", "gpt-4o-mini");
    assert.deepEqual(model.cost, {
        prompt_tokens: 30,
        completion_tokens: 13,
        total_tokens: 43,
    });

    const persisted = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    const persistedModel = persisted.models.openai.models.find((entry) => entry.id === "gpt-4o-mini");
    assert.deepEqual(persistedModel.cost, model.cost);
});

test("ConfigStore preserves slashes inside configured model refs", () => {
    const configFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cragent-model-ref-")), "config.json");
    const store = new ConfigStore(configFile);
    store.update({
        ...store.get(),
        agents: {
            ...store.get().agents,
            default: {
                ...store.get().agents.default,
                model: {
                    primary: "openai/azure/o4-mini",
                    fallbacks: ["openai/gpt-5", "openai/azure/o4-mini"],
                },
            },
        },
    });

    assert.deepEqual(store.resolvePrimaryRef(), {
        providerKey: "openai",
        modelId: "azure/o4-mini",
    });
    assert.deepEqual(store.resolveModelChain("openai", "gpt-4o-mini"), [
        { providerKey: "openai", modelId: "gpt-4o-mini" },
        { providerKey: "openai", modelId: "gpt-5" },
        { providerKey: "openai", modelId: "azure/o4-mini" },
    ]);
});

test("LlmClient reports token usage from chat response", async () => {
    const usageCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
        new Response(
            JSON.stringify({
                choices: [{ message: { role: "assistant", content: "ok" } }],
                usage: {
                    prompt_tokens: 12,
                    completion_tokens: 4,
                    total_tokens: 16,
                },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );

    try {
        const client = new LlmClient(
            () => ({
                baseUrl: "https://api.example.com/v1",
                apiKey: "sk-test",
                api: "chat/completions",
            }),
            {
                onTokenUsage: (model, usage) => usageCalls.push({ model, usage }),
            },
        );
        const result = await client.chat({
            model: { providerKey: "openai", modelId: "gpt-4o-mini" },
            messages: [{ role: "user", content: "hello" }],
        });
        assert.equal(result.message.content, "ok");
        assert.deepEqual(result.usage, {
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16,
        });
        assert.equal(usageCalls.length, 1);
        assert.deepEqual(usageCalls[0].model, {
            providerKey: "openai",
            modelId: "gpt-4o-mini",
        });
    } finally {
        globalThis.fetch = originalFetch;
    }
});
