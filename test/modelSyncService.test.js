import test from "node:test";
import assert from "node:assert/strict";
import { mergeProviderModels } from "../src/main/modelSyncService.js";

test("mergeProviderModels keeps existing model settings", () => {
  const provider = {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    api: "chat/completions",
    models: [
      {
        id: "gpt-4o-mini",
        name: "gpt-4o-mini",
        state: true,
        contextWindow: 200000,
      },
    ],
  };

  const merged = mergeProviderModels(provider, ["gpt-4o-mini", "gpt-5"]);
  assert.equal(merged.models.length, 2);
  assert.equal(merged.models[0].state, true);
  assert.equal(merged.models[0].contextWindow, 200000);
  assert.equal(merged.models[1].id, "gpt-5");
  assert.equal(merged.models[1].state, false);
});
