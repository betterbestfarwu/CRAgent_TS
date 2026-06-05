import test from "node:test";
import assert from "node:assert/strict";
import {
    buildCompactTranscript,
    buildPostCompactContext,
    calculateContextWarningState,
    calculateMessagesContextWarningState,
    shrinkSubAgentMessages,
    MICROCOMPACT_CLEARED_MARKER,
    formatCompactSummary,
    getAutoCompactThreshold,
    microCompactMessages,
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
    DEFAULT_BOOTSTRAP_OVERHEAD,
    estimateMessageTokens,
    estimateSessionContextBreakdown,
    estimateSessionContextUsage,
    reconcileContextBreakdownCategories,
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
    assert.equal(threshold, 170_000);
    assert.equal(
        getAutoCompactThreshold({ contextWindow: 128_000, maxTokens: 8192 }),
        128_000 - 8192 - 13_000,
    );

    const shortSession = {
        meta: { llmContextFromIndex: 0, compactFailures: 0 },
        messages: [{ role: "user", content: "hi" }],
    };
    assert.equal(shouldAutoCompact(shortSession, model), false);

    const triggerPayloadTokens = threshold - DEFAULT_BOOTSTRAP_OVERHEAD;
    const belowSession = {
        meta: { llmContextFromIndex: 0, compactFailures: 0 },
        messages: [{ role: "user", content: "x".repeat((triggerPayloadTokens - 1) * 3) }],
    };
    assert.equal(shouldAutoCompact(belowSession, model), false);

    const hugeContent = "x".repeat(triggerPayloadTokens * 3);
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

test("shrinkSubAgentMessages drops oldest tool rounds after micro-compact", () => {
    const messages = [
        { role: "system", content: "sub-agent system" },
        { role: "user", content: "task prompt" },
        { role: "assistant", content: "a1", toolCalls: [{ id: "c1", function: { name: "read_file", arguments: "{}" } }] },
        { role: "tool", name: "read_file", toolCallId: "c1", content: "old-output-1".repeat(4000) },
        { role: "assistant", content: "a2", toolCalls: [{ id: "c2", function: { name: "read_file", arguments: "{}" } }] },
        { role: "tool", name: "read_file", toolCallId: "c2", content: "old-output-2".repeat(4000) },
        { role: "assistant", content: "a3", toolCalls: [{ id: "c3", function: { name: "read_file", arguments: "{}" } }] },
        { role: "tool", name: "read_file", toolCallId: "c3", content: "recent-output".repeat(4000) },
    ];
    const changed = shrinkSubAgentMessages(messages);
    assert.equal(changed, true);
    assert.equal(messages[0].role, "system");
    assert.equal(messages[1].content, "task prompt");
    assert.ok(
        messages.length < 8 ||
            messages.some((message) => message.content === MICROCOMPACT_CLEARED_MARKER),
    );
});

test("calculateMessagesContextWarningState matches session helper for active messages", () => {
    const model = { contextWindow: 200_000, maxTokens: 8192 };
    const session = {
        meta: { llmContextFromIndex: 0 },
        messages: [{ role: "user", content: "hello" }],
    };
    const fromState = calculateContextWarningState(session, model);
    const fromMessages = calculateMessagesContextWarningState(session.messages, model);
    assert.equal(fromState.tokens, fromMessages.tokens + DEFAULT_BOOTSTRAP_OVERHEAD);
    assert.equal(fromState.autoCompactThreshold, fromMessages.autoCompactThreshold);
    assert.equal(fromState.isAtBlockingLimit, fromMessages.isAtBlockingLimit);
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
    assert.equal(state.isAtBlockingLimit, true);
});

test("inline image payload text does not block context after sanitizing estimate", () => {
    const model = { contextWindow: 20_000, maxTokens: 1024 };
    const dataUrl = `data:image/png;base64,${"A".repeat(400_000)}`;
    const session = {
        meta: { llmContextFromIndex: 0 },
        messages: [{ role: "tool", name: "image_tool", content: `Generated ${dataUrl}` }],
    };
    const state = calculateContextWarningState(session, model);

    assert.equal(estimateMessageTokens(session.messages[0]) < 500, true);
    assert.equal(state.isAtBlockingLimit, false);
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

test("estimateSessionContextBreakdown keeps non-negative categories aligned to total", () => {
    const session = {
        meta: { llmContextFromIndex: 0, todos: [{ id: "1", status: "pending", content: "task" }] },
        messages: [{ id: "1", role: "user", content: "hi" }],
    };
    const model = { contextWindow: 200_000, maxTokens: 8192 };
    const agentTools = {
        enable_tools: true,
        enable_file_tools: true,
        enable_skills: true,
        allow_sub_agents: true,
    };

    const breakdown = estimateSessionContextBreakdown(session, model, {
        agentTools,
        skillsCatalogText: "- demo: example skill\n".repeat(20),
    });

    for (const category of breakdown.categories) {
        assert.ok(category.tokens >= 0, `${category.id} must be non-negative`);
    }

    const categorizedTotal = breakdown.categories.reduce((sum, category) => sum + category.tokens, 0);
    assert.equal(categorizedTotal, breakdown.tokens);

    const system = breakdown.categories.find((category) => category.id === "systemPrompt");
    if (system) {
        assert.ok(system.tokens >= 0);
    }
});

test("reconcileContextBreakdownCategories realigns categories after system prompt is injected", () => {
    const targetTotal = 8500;
    const categories = [
        { id: "toolDefinitions", label: "Tool definitions", color: "#a855f7", tokens: 4700 },
        { id: "rules", label: "Rules", color: "#22c55e", tokens: 2400 },
        { id: "skills", label: "Skills", color: "#eab308", tokens: 52 },
        { id: "mcp", label: "MCP", color: "#ec4899", tokens: 788 },
        { id: "subagentDefinitions", label: "Subagent definitions", color: "#3b82f6", tokens: 258 },
        { id: "conversation", label: "Conversation", color: "#ea580c", tokens: 320 },
        { id: "systemPrompt", label: "System prompt", color: "#9ca3af", tokens: 1000 },
    ];

    const reconciled = reconcileContextBreakdownCategories(categories, targetTotal);
    const categorizedTotal = reconciled.reduce((sum, category) => sum + category.tokens, 0);

    assert.equal(categorizedTotal, targetTotal);
    assert.ok(reconciled.some((category) => category.id === "systemPrompt"));
});

test("reconcileContextBreakdownCategories keeps tiny non-zero categories visible", () => {
    const reconciled = reconcileContextBreakdownCategories(
        [
            { id: "systemPrompt", label: "System prompt", color: "#9ca3af", tokens: 9000 },
            { id: "conversation", label: "Conversation", color: "#ea580c", tokens: 1 },
        ],
        8000,
    );

    assert.equal(reconciled.reduce((sum, category) => sum + category.tokens, 0), 8000);
    assert.equal(reconciled.find((category) => category.id === "conversation")?.tokens, 1);
});
