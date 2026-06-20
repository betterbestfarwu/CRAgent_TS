import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    buildLargeToolResultMessage,
    enforceToolResultBudget,
    ensureNonEmptyToolContent,
    finalizeToolResultForLlm,
    generatePreview,
    getToolResultPath,
    isPersistedToolResultContent,
    maybePersistLargeToolResult,
    persistToolResult,
} from "../src/main/toolResultStorage.js";
import {
    DEFAULT_MAX_RESULT_SIZE_CHARS,
    MAX_TOOL_RESULTS_PER_ROUND_CHARS,
    PERSISTED_OUTPUT_TAG,
} from "../src/shared/toolLimits.js";
import { truncateShellOutput, getMaxBashOutputChars } from "../src/main/shellOutputLimits.js";

test("ensureNonEmptyToolContent injects placeholder for empty output", () => {
    assert.equal(ensureNonEmptyToolContent("", "bash"), "(bash completed with no output)");
    assert.equal(ensureNonEmptyToolContent("ok", "bash"), "ok");
});

test("generatePreview truncates at newline when possible", () => {
    const content = "line1\nline2\nline3";
    const { preview, hasMore } = generatePreview(content, 12);
    assert.equal(preview, "line1\nline2");
    assert.equal(hasMore, true);
});

test("maybePersistLargeToolResult keeps small content inline", async () => {
    const out = await maybePersistLargeToolResult("hello", {
        toolName: "grep",
        toolUseId: "call-1",
        maxResultSizeChars: 1000,
        sessionsDir: "/tmp",
        sessionId: "s1",
    });
    assert.equal(out, "hello");
});

test("maybePersistLargeToolResult persists large content to session tool-results", async () => {
    const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-toolres-"));
    const sessionId = "sess-1";
    const large = "x".repeat(DEFAULT_MAX_RESULT_SIZE_CHARS + 100);
    const out = await maybePersistLargeToolResult(large, {
        toolName: "grep",
        toolUseId: "call-big",
        maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
        sessionsDir,
        sessionId,
    });
    assert.ok(isPersistedToolResultContent(out));
    assert.match(out, /Full output saved to:/);
    const filePath = getToolResultPath(sessionsDir, sessionId, "call-big");
    assert.ok(fs.existsSync(filePath));
    assert.equal(fs.readFileSync(filePath, "utf-8").length, large.length);
});

test("persistToolResult stores text block arrays as json", async () => {
    const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-toolres-json-"));
    const sessionId = "sess-json";
    const blocks = [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
    ];
    const result = await persistToolResult(blocks, sessionsDir, sessionId, "call-json");

    assert.equal(result.error, undefined);
    assert.equal(result.isJson, true);
    assert.match(result.filepath, /\.json$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(result.filepath, "utf-8")), blocks);
});

test("persistToolResult rejects non-text block arrays", async () => {
    const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-toolres-image-"));
    const result = await persistToolResult(
        [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }],
        sessionsDir,
        "sess-image",
        "call-image",
    );

    assert.equal(result.error, "Cannot persist tool results containing non-text content");
});

test("maybePersistLargeToolResult falls back inline for non-text block arrays", async () => {
    const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-toolres-inline-"));
    const blocks = [
        { type: "text", text: "x".repeat(DEFAULT_MAX_RESULT_SIZE_CHARS + 100) },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
    ];
    const out = await maybePersistLargeToolResult(blocks, {
        toolName: "mcp__vision__capture",
        toolUseId: "call-mixed",
        maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
        sessionsDir,
        sessionId: "sess-inline",
    });

    assert.equal(out, blocks);
});

test("maybePersistLargeToolResult skips persistence for Infinity threshold", async () => {
    const large = "y".repeat(DEFAULT_MAX_RESULT_SIZE_CHARS + 50);
    const out = await maybePersistLargeToolResult(large, {
        toolName: "read_file",
        toolUseId: "call-read",
        maxResultSizeChars: Infinity,
        sessionsDir: "/tmp",
        sessionId: "s1",
    });
    assert.equal(out, large);
});

test("enforceToolResultBudget persists largest fresh tool results in a round", async () => {
    const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-budget-"));
    const sessionId = "sess-budget";
    const state = { seenIds: new Set(), replacements: new Map() };
    const chunk = "z".repeat(101_000);
    const messages = [
        { role: "assistant", content: "", toolCalls: [{ id: "a1", function: { name: "bash" } }] },
        { role: "tool", name: "bash", toolCallId: "a1", content: chunk },
        { role: "tool", name: "bash", toolCallId: "a2", content: chunk },
        { role: "tool", name: "bash", toolCallId: "a3", content: chunk },
    ];
    const result = await enforceToolResultBudget(messages, state, {
        sessionsDir,
        sessionId,
        limit: MAX_TOOL_RESULTS_PER_ROUND_CHARS,
    });
    assert.equal(result.changed, true);
    const persistedCount = result.messages.filter((message) =>
        isPersistedToolResultContent(message.content),
    ).length;
    assert.ok(persistedCount >= 2);
    assert.ok(state.seenIds.has("a1"));
    assert.ok(state.seenIds.has("a2"));
    assert.ok(state.seenIds.has("a3"));
});

test("truncateShellOutput respects default 30k limit", () => {
    const max = getMaxBashOutputChars();
    assert.equal(max, 30_000);
    const long = "a".repeat(max + 5000);
    const out = truncateShellOutput(long);
    assert.ok(out.length < long.length);
    assert.match(out, /lines truncated/);
});

test("finalizeToolResultForLlm preserves image tool results", async () => {
    const out = await finalizeToolResultForLlm(
        { content: "", images: [{ dataUrl: "data:image/png;base64,abc", mimeType: "image/png" }] },
        {
            toolName: "mcp__x__shot",
            toolUseId: "img-1",
            sessionsDir: "/tmp",
            sessionId: "s1",
        },
    );
    assert.equal(out.content, "(mcp__x__shot completed with no output)");
    assert.equal(out.images.length, 1);
});

test("buildLargeToolResultMessage wraps preview metadata", () => {
    const message = buildLargeToolResultMessage({
        filepath: "/tmp/out.txt",
        originalSize: 99_999,
        preview: "hello",
        hasMore: true,
    });
    assert.ok(message.startsWith(PERSISTED_OUTPUT_TAG));
    assert.match(message, /\/tmp\/out\.txt/);
});
