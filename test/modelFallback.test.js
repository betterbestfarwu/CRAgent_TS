import test from "node:test";
import assert from "node:assert/strict";
import {
    isContextOverflowError,
    isRetryableLlmError,
} from "../src/main/modelFallback.js";

test("isContextOverflowError detects HTTP 413", () => {
    const error = new Error("模型请求失败: 413 payload too large");
    error.status = 413;
    assert.equal(isContextOverflowError(error), true);
    assert.equal(isRetryableLlmError(error), false);
});

test("isContextOverflowError detects token limit phrases", () => {
    assert.equal(
        isContextOverflowError(new Error("maximum context length exceeded")),
        true,
    );
    assert.equal(isContextOverflowError(new Error("invalid API Key")), false);
});
