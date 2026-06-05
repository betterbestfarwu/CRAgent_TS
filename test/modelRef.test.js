import test from "node:test";
import assert from "node:assert/strict";
import { formatModelRef, modelRefLabel, parseModelRef } from "../src/shared/modelRef.js";

test("formatModelRef builds provider/model path", () => {
  assert.equal(formatModelRef("openai", "gpt-4o"), "openai/gpt-4o");
});

test("parseModelRef preserves slashes inside model ids", () => {
  assert.deepEqual(parseModelRef("openai/azure/o4-mini"), {
    providerKey: "openai",
    modelId: "azure/o4-mini",
  });
  assert.equal(parseModelRef("gpt-4o"), null);
  assert.equal(parseModelRef("openai/"), null);
});

test("modelRefLabel returns only the model id segment", () => {
  assert.equal(modelRefLabel("anthropic/claude-opus-4-5"), "claude-opus-4-5");
  assert.equal(modelRefLabel("openai/azure/o4-mini"), "azure/o4-mini");
  assert.equal(modelRefLabel("gpt-4o"), "gpt-4o");
  assert.equal(modelRefLabel(""), "");
});
