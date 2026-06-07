import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS,
    DEFAULT_LLM_TEMPERATURE,
    DEFAULT_UI_CONFIG,
    mergeUiConfig,
    resolveLlmRequestTimeoutMs,
    resolveLlmTemperature,
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

    it("defaults llm temperature to 0.7", () => {
        assert.equal(DEFAULT_UI_CONFIG.llm_temperature, 0.7);
        assert.equal(DEFAULT_LLM_TEMPERATURE, 0.7);
        assert.equal(resolveLlmTemperature(), 0.7);
    });

    it("resolves configured temperature within 0–1", () => {
        assert.equal(resolveLlmTemperature({ llm_temperature: 0.5 }), 0.5);
        assert.equal(resolveLlmTemperature({ llm_temperature: 0 }), 0);
        assert.equal(resolveLlmTemperature({ llm_temperature: -0.5 }), 0);
        assert.equal(resolveLlmTemperature({ llm_temperature: 1.5 }), 1);
    });

    it("falls back when temperature is missing or invalid", () => {
        assert.equal(resolveLlmTemperature({}), 0.7);
        assert.equal(resolveLlmTemperature({ llm_temperature: NaN }), 0.7);
        assert.equal(mergeUiConfig({ llm_temperature: 0.8 }).llm_temperature, 0.8);
    });
});
