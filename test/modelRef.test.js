import test from "node:test";
import assert from "node:assert/strict";
import { formatModelRef, modelRefLabel } from "../src/shared/modelRef.js";

test("formatModelRef builds provider/model path", () => {
  assert.equal(formatModelRef("openai", "gpt-4o"), "openai/gpt-4o");
});

test("modelRefLabel returns only the model id segment", () => {
  assert.equal(modelRefLabel("anthropic/claude-opus-4-5"), "claude-opus-4-5");
  assert.equal(modelRefLabel("gpt-4o"), "gpt-4o");
  assert.equal(modelRefLabel(""), "");
});
