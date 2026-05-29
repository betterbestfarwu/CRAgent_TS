import test from "node:test";
import assert from "node:assert/strict";
import { buildModelChain, isRetryableLlmError, parseModelRef } from "../src/main/modelFallback.js";
import { formatTodosForPrompt, mergeTodos } from "../src/main/todoState.js";
import { filterToolsForSubAgent } from "../src/main/subAgentTypes.js";

test("parseModelRef splits provider/model", () => {
    assert.deepEqual(parseModelRef("openai/gpt-4o-mini"), {
        providerKey: "openai",
        modelId: "gpt-4o-mini",
    });
    assert.equal(parseModelRef("bad"), null);
});

test("buildModelChain deduplicates primary and fallbacks", () => {
    const chain = buildModelChain(
        { providerKey: "openai", modelId: "gpt-4o-mini" },
        ["openai/gpt-5", "openai/gpt-4o-mini", "anthropic/claude-opus-4-5"],
    );
    assert.deepEqual(chain, [
        { providerKey: "openai", modelId: "gpt-4o-mini" },
        { providerKey: "openai", modelId: "gpt-5" },
        { providerKey: "anthropic", modelId: "claude-opus-4-5" },
    ]);
});

test("isRetryableLlmError skips config errors", () => {
    assert.equal(isRetryableLlmError(new Error("请先在设置中配置有效 API Key")), false);
    assert.equal(isRetryableLlmError(new Error("模型请求失败: 429")), true);
});

test("mergeTodos replaces or merges by id", () => {
    const existing = [{ id: "a", content: "one", status: "pending" }];
    const incoming = [{ id: "b", content: "two", status: "in_progress" }];
    assert.deepEqual(mergeTodos(existing, incoming, false), incoming);
    assert.deepEqual(mergeTodos(existing, incoming, true), [
        { id: "a", content: "one", status: "pending" },
        { id: "b", content: "two", status: "in_progress" },
    ]);
});

test("formatTodosForPrompt renders active todos", () => {
    const text = formatTodosForPrompt([
        { id: "1", content: "Ship feature", status: "in_progress" },
    ]);
    assert.match(text, /Ship feature/);
    assert.match(text, /in_progress/);
});

test("filterToolsForSubAgent limits explore tools", () => {
    const tools = [
        { name: "read_file" },
        { name: "bash" },
        { name: "Task" },
    ];
    const filtered = filterToolsForSubAgent(tools, "explore");
    assert.deepEqual(
        filtered.map((tool) => tool.name),
        ["read_file"],
    );
});
