import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigStore } from "../src/main/configStore.js";
import {
    mergeSyncedProviderIntoConfig,
    removeProviderFromConfig,
    renameProviderInConfig,
} from "../src/shared/modelsConfig.js";

function sampleConfig() {
    return {
        models: {
            openai: {
                baseUrl: "https://api.openai.com/v1",
                apiKey: "sk-openai",
                api: "chat/completions",
                state: true,
                models: [{ id: "gpt-4o-mini", state: true }],
            },
            anthropic: {
                baseUrl: "https://api.anthropic.com/v1",
                apiKey: "sk-anthropic",
                api: "chat/completions",
                state: true,
                models: [{ id: "claude-opus-4-5", state: true }],
            },
        },
        agents: {
            default: {
                model: {
                    primary: "anthropic/claude-opus-4-5",
                    fallbacks: ["openai/gpt-4o-mini", "anthropic/claude-opus-4-5"],
                },
            },
        },
    };
}

test("removeProviderFromConfig drops provider and rewires default model refs", () => {
    const next = removeProviderFromConfig(sampleConfig(), "anthropic");
    assert.deepEqual(Object.keys(next.models), ["openai"]);
    assert.equal(next.agents.default.model.primary, "openai/gpt-4o-mini");
    assert.deepEqual(next.agents.default.model.fallbacks, ["openai/gpt-4o-mini"]);
});

test("renameProviderInConfig moves provider key and updates model refs", () => {
    const next = renameProviderInConfig(sampleConfig(), "openai", "openai-proxy");
    assert.deepEqual(Object.keys(next.models).sort(), ["anthropic", "openai-proxy"]);
    assert.equal(next.agents.default.model.primary, "anthropic/claude-opus-4-5");
    assert.deepEqual(next.agents.default.model.fallbacks, [
        "openai-proxy/gpt-4o-mini",
        "anthropic/claude-opus-4-5",
    ]);
});

test("mergeSyncedProviderIntoConfig updates one provider without restoring deleted providers", () => {
    const draft = removeProviderFromConfig(sampleConfig(), "anthropic");
    const syncedProvider = {
        ...sampleConfig().models.openai,
        models: [{ id: "gpt-5", state: true }],
    };
    const next = mergeSyncedProviderIntoConfig(draft, "openai", syncedProvider);
    assert.deepEqual(Object.keys(next.models), ["openai"]);
    assert.equal(next.models.openai.models[0].id, "gpt-5");
});

test("syncProviderModels applies draft models before updating provider on disk", () => {
    const configFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cragent-sync-")), "config.json");
    const store = new ConfigStore(configFile);
    const initial = store.get();
    store.update({
        ...initial,
        models: sampleConfig().models,
        agents: sampleConfig().agents,
    });

    const draftModels = removeProviderFromConfig(store.get(), "anthropic").models;
    store.update({
        ...store.get(),
        models: draftModels,
    });
    store.updateProvider("openai", {
        ...store.get().models.openai,
        models: [{ id: "gpt-5", state: true }],
    });

    const persisted = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    assert.equal("anthropic" in persisted.models, false);
    assert.equal(persisted.models.openai.models[0].id, "gpt-5");
});

test("ConfigStore.update persists provider removal from config", () => {
    const configFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cragent-models-")), "config.json");
    const store = new ConfigStore(configFile);
    const initial = store.get();
    store.update({
        ...initial,
        models: {
            ...initial.models,
            anthropic: sampleConfig().models.anthropic,
        },
        agents: sampleConfig().agents,
    });

    const next = removeProviderFromConfig(store.get(), "anthropic");
    store.update(next);

    const persisted = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    assert.equal("anthropic" in persisted.models, false);
    assert.equal("openai" in persisted.models, true);
});
