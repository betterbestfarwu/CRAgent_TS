import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS,
    DEFAULT_UI_CONFIG,
    mergeUiConfig,
    resolveLlmRequestTimeoutMs,
} from "../src/shared/uiConfig.js";

describe("uiConfig", () => {
    it("defaults llm request timeout to five minutes", () => {
        assert.equal(DEFAULT_UI_CONFIG.llm_request_timeout_seconds, 300);
        assert.equal(DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS, 300);
        assert.equal(resolveLlmRequestTimeoutMs(), 300_000);
    });

    it("resolves configured timeout seconds to milliseconds", () => {
        assert.equal(resolveLlmRequestTimeoutMs({ llm_request_timeout_seconds: 120 }), 120_000);
    });

    it("falls back when timeout is missing or invalid", () => {
        assert.equal(resolveLlmRequestTimeoutMs({}), 300_000);
        assert.equal(resolveLlmRequestTimeoutMs({ llm_request_timeout_seconds: 0 }), 300_000);
        assert.equal(mergeUiConfig({ llm_request_timeout_seconds: 600 }).llm_request_timeout_seconds, 600);
    });
});
