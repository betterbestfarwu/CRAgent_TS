import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExecutionMode } from "../src/shared/executionMode.js";

test("normalizeExecutionMode keeps explicit session mode over config default", () => {
    assert.equal(normalizeExecutionMode("goal", "plan"), "goal");
    assert.equal(normalizeExecutionMode("plan", "goal"), "plan");
});

test("normalizeExecutionMode falls back when session mode is unset", () => {
    assert.equal(normalizeExecutionMode(undefined, "plan"), "plan");
    assert.equal(normalizeExecutionMode(null, "goal"), "goal");
    assert.equal(normalizeExecutionMode("", "plan"), "plan");
});
