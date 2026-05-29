import test from "node:test";
import assert from "node:assert/strict";
import {
    buildCompactTranscript,
    buildPostCompactContext,
    calculateContextWarningState,
    formatCompactSummary,
    getAutoCompactThreshold,
    microCompactMessages,
    MICROCOMPACT_CLEARED_MARKER,
    shouldAutoCompact,
    splitMessagesForCompact,
    trackLoadedSkill,
    trackReadFile,
    trySessionMemoryCompact,
} from "../src/main/contextCompression.js";
import { groupMessagesByApiRound, truncateGroupsFromHead } from "../src/main/contextGrouping.js";
import {
    formatSessionMemory,
    shouldRefreshSessionMemory,
} from "../src/main/sessionMemory.js";
import {
    estimateMessageTokens,
    estimateSessionContextUsage,
} from "../src/shared/tokenEstimator.js";

test("formatCompactSummary extracts summary block and strips analysis", () => {
    const raw = `<analysis>thinking</analysis>
<summary>
<section name="user_messages">User said hello</section>
</summary>`;
    assert.match(formatCompactSummary(raw), /User said hello/);
    assert.doesNotMatch(formatCompactSummary(raw), /thinking/);
});

test("microCompactMessages clears old compactable tool results", () => {
    const messages = Array.from({ length: 8 }, (_item, index) => ({
        id: String(index),
        role: "tool",
        name: "read_file",
        content: `payload-${index}`.repeat(40),
    }));
    messages.push({
        id: "assistant",
        role: "assistant",
        content: "done",
        createdAt: new Date().toISOString(),
    });
    const { cleared } = microCompactMessages(messages, {
        microcompact_keep_recent: 3,
        microcompact_idle_minutes: 9999,
    });
    assert.equal(cleared, 5);
    assert.equal(messages[0].content, MICROCOMPACT_CLEARED_MARKER);
    assert.equal(messages[7].content, "payload-7".repeat(40));
});

test("splitMessagesForCompact preserves tool pairs", () => {
    const messages = [
        { id: "1", role: "user", content: "old question" },
        { id: "2", role: "assistant", content: "", toolCalls: [{ id: "call-1", function: { name: "read_file" } }] },
        { id: "3", role: "tool", name: "read_file", toolCallId: "call-1", content: "file body" },
        { id: "4", role: "user", content: "one" },
        { id: "5", role: "assistant", content: "answer one" },
        { id: "6", role: "user", content: "two" },
        { id: "7", role: "assistant", content: "answer two" },
        { id: "8", role: "user", content: "three" },
        { id: "9", role: "assistant", content: "answer three" },
        { id: "10", role: "user", content: "four" },
        { id: "11", role: "assistant", content: "answer four" },
        { id: "12", role: "user", content: "five" },
        { id: "13", role: "assistant", content: "answer five" },
    ];
    const { toSummarize, keep } = splitMessagesForCompact(messages, {
        keep_min_tokens: 1,
        keep_min_text_messages: 2,
        keep_max_tokens: 100_000,
    });
    assert.ok(toSummarize.length > 0);
    const keepIds = new Set(keep.map((message) => message.id));
    if (keepIds.has("3")) {
        assert.ok(keepIds.has("2"));
    }
    assert.ok(keepIds.has("13"));
});

test("shouldAutoCompact respects threshold and failure circuit breaker", () => {
    const model = { contextWindow: 200_000, maxTokens: 8192 };
    const threshold = getAutoCompactThreshold(model);
    assert.equal(threshold, 200_000 - 8192 - 13_000);

    const shortSession = {
        meta: { llmContextFromIndex: 0, compactFailures: 0 },
        messages: [{ role: "user", content: "hi" }],
    };
    assert.equal(shouldAutoCompact(shortSession, model), false);

    const hugeContent = "x".repeat(threshold * 4);
    const longSession = {
        meta: { llmContextFromIndex: 0, compactFailures: 0 },
        messages: [{ role: "user", content: hugeContent }],
    };
    assert.equal(shouldAutoCompact(longSession, model), true);

    longSession.meta.compactFailures = 3;
    assert.equal(shouldAutoCompact(longSession, model), false);
});

test("microCompactMessages uses idle keep count after inactivity", () => {
    const staleAssistant = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const messages = [
        { id: "0", role: "tool", name: "bash", content: "old".repeat(200) },
        { id: "1", role: "tool", name: "bash", content: "mid".repeat(200) },
        { id: "2", role: "tool", name: "bash", content: "new".repeat(200) },
        { id: "3", role: "assistant", content: "done", createdAt: staleAssistant },
    ];
    const { cleared, keepRecent } = microCompactMessages(messages, {
        microcompact_keep_recent: 5,
        microcompact_idle_minutes: 30,
        microcompact_idle_keep_recent: 1,
    });
    assert.equal(keepRecent, 1);
    assert.equal(cleared, 2);
});

test("groupMessagesByApiRound splits at user turns", () => {
    const messages = [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
        { role: "assistant", content: "d" },
    ];
    const groups = groupMessagesByApiRound(messages);
    assert.equal(groups.length, 2);
    assert.equal(groups[1][0].content, "c");
});

test("buildCompactTranscript drops oldest groups when input is too large", () => {
    const session = { meta: {} };
    const toSummarize = [
        { role: "user", content: "old ".repeat(20_000) },
        { role: "assistant", content: "middle" },
        { role: "user", content: "recent" },
        { role: "assistant", content: "ok" },
    ];
    const { droppedGroups, transcript } = buildCompactTranscript(session, toSummarize, {
        compact_max_input_tokens: 5000,
        compact_ptl_max_retries: 3,
    });
    assert.ok(droppedGroups >= 1);
    assert.doesNotMatch(transcript, /old/);
    assert.match(transcript, /recent/);
});

test("trySessionMemoryCompact uses memory when coverage is sufficient", () => {
    const entries = [
        { message: { role: "user", content: "old" }, index: 0 },
        { message: { role: "assistant", content: "ok" }, index: 1 },
        { message: { role: "user", content: "new" }, index: 2 },
    ];
    const session = {
        meta: {
            sessionMemory: "<section name=\"current_work\">working</section>",
            sessionMemoryUpToIndex: 1,
        },
    };
    const result = trySessionMemoryCompact(session, entries, 2);
    assert.equal(result.ok, true);
    assert.match(result.summary, /working/);
});

test("formatSessionMemory extracts memory block", () => {
    const raw = `<analysis>x</analysis><memory>stored facts</memory>`;
    assert.equal(formatSessionMemory(raw), "stored facts");
});

test("calculateContextWarningState exposes warning and auto thresholds", () => {
    const model = { contextWindow: 200_000, maxTokens: 8192 };
    const session = {
        meta: { llmContextFromIndex: 0 },
        messages: [{ role: "user", content: "x".repeat(700_000) }],
    };
    const state = calculateContextWarningState(session, model);
    assert.equal(state.isAboveWarningThreshold, true);
    assert.equal(state.isAboveAutoCompactThreshold, true);
});

test("truncateGroupsFromHead removes oldest rounds", () => {
    const messages = [
        { role: "user", content: "round1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "round2" },
        { role: "assistant", content: "a2" },
    ];
    const truncated = truncateGroupsFromHead(messages, 1);
    assert.deepEqual(
        truncated.map((message) => message.content),
        ["round2", "a2"],
    );
});

test("trackLoadedSkill appears in post compact context", () => {
    const session = { meta: {} };
    trackReadFile(session, "/tmp/a.ts", "alpha");
    trackLoadedSkill(session, "deploy", "skill body");
    const context = buildPostCompactContext(session, {
        post_compact_max_files: 5,
        post_compact_token_budget: 50_000,
        post_compact_max_tokens_per_file: 5000,
        post_compact_skills_token_budget: 25_000,
        post_compact_max_tokens_per_skill: 5000,
        post_compact_max_skills: 3,
    });
    assert.match(context, /recent_context_after_compact/);
    assert.match(context, /deploy/);
});

test("shouldRefreshSessionMemory waits for enough pending tokens", () => {
    const session = {
        meta: { llmContextFromIndex: 0 },
        messages: [{ role: "user", content: "hi" }],
    };
    assert.equal(shouldRefreshSessionMemory(session), false);
    session.messages.push({ role: "assistant", content: "hello ".repeat(400) });
    assert.equal(shouldRefreshSessionMemory(session), true);
});

test("mergeContextConfig fills defaults", async () => {
    const { mergeContextConfig, DEFAULT_CONTEXT_CONFIG } = await import(
        "../src/shared/contextConfig.js"
    );
    assert.deepEqual(mergeContextConfig({ auto_compact_enabled: false }), {
        ...DEFAULT_CONTEXT_CONFIG,
        auto_compact_enabled: false,
    });
});

test("estimateSessionContextUsage counts summary and active messages", () => {
    const session = {
        meta: {
            llmContextFromIndex: 1,
            contextSummary: "summary text",
        },
        messages: [
            { role: "user", content: "ignored old" },
            { role: "user", content: "active message" },
        ],
    };
    const usage = estimateSessionContextUsage(session, { contextWindow: 128_000, maxTokens: 8192 });
    assert.ok(usage.tokens > estimateMessageTokens({ role: "user", content: "active message" }));
    assert.equal(usage.contextWindow, 128_000);
});
