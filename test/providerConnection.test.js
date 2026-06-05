import test from "node:test";
import assert from "node:assert/strict";
import {
    applyProviderConnection,
    hasValidProviderApiKey,
    validateProviderConnectionFields,
} from "../src/shared/providerConnection.js";

test("applyProviderConnection uses connection values directly", () => {
    const existing = {
        baseUrl: "https://old.example.com/v1",
        apiKey: "sk-existing",
        api: "chat/completions",
    };
    const applied = applyProviderConnection(existing, {
        baseUrl: "https://new.example.com/v1",
        apiKey: "",
        api: "responses",
    });
    assert.equal(applied.baseUrl, "https://new.example.com/v1");
    assert.equal(applied.apiKey, "");
    assert.equal(applied.api, "responses");
});

test("validateProviderConnectionFields reports empty base URL", () => {
    const result = validateProviderConnectionFields({
        baseUrl: "  ",
        apiKey: "sk-test",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "Base URL 不能为空");
});

test("validateProviderConnectionFields reports missing api key", () => {
    const result = validateProviderConnectionFields({
        baseUrl: "https://api.example.com/v1",
        apiKey: "",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "请先配置有效 API Key");
});

test("validateProviderConnectionFields accepts valid connection", () => {
    const result = validateProviderConnectionFields({
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test",
    });
    assert.equal(result.ok, true);
});

test("hasValidProviderApiKey rejects empty and placeholder keys", () => {
    assert.equal(hasValidProviderApiKey(""), false);
    assert.equal(hasValidProviderApiKey("sk-REPLACE_ME"), false);
    assert.equal(hasValidProviderApiKey("sk-test"), true);
});
