import test from "node:test";
import assert from "node:assert/strict";
import {
    appendedMessagesNeedFullRender,
    CONTEXT_COMPACT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_ROLE,
    dedupeConsecutiveContextDividers,
    sessionHasActiveLlmContext,
} from "../src/shared/chatMessages.js";

function divider(content) {
    return { id: `d-${content}`, role: CONTEXT_DIVIDER_ROLE, content };
}

test("dedupeConsecutiveContextDividers collapses adjacent same-label dividers", () => {
    const messages = [
        { id: "u1", role: "user", content: "hello" },
        divider(CONTEXT_DIVIDER_LABEL),
        divider(CONTEXT_DIVIDER_LABEL),
        { id: "u2", role: "user", content: "again" },
    ];
    const deduped = dedupeConsecutiveContextDividers(messages);
    assert.equal(deduped.length, 3);
    assert.equal(deduped[1].content, CONTEXT_DIVIDER_LABEL);
});

test("dedupeConsecutiveContextDividers keeps different divider labels", () => {
    const messages = [
        divider(CONTEXT_DIVIDER_LABEL),
        divider(CONTEXT_COMPACT_DIVIDER_LABEL),
    ];
    const deduped = dedupeConsecutiveContextDividers(messages);
    assert.equal(deduped.length, 2);
});

test("dedupeConsecutiveContextDividers keeps separated same-label dividers", () => {
    const messages = [
        divider(CONTEXT_DIVIDER_LABEL),
        { id: "u1", role: "user", content: "between" },
        divider(CONTEXT_DIVIDER_LABEL),
    ];
    const deduped = dedupeConsecutiveContextDividers(messages);
    assert.equal(deduped.length, 3);
});

test("sessionHasActiveLlmContext false when context already cleared", () => {
    const session = {
        meta: { llmContextFromIndex: 2 },
        messages: [
            { id: "u1", role: "user", content: "old" },
            divider(CONTEXT_DIVIDER_LABEL),
        ],
    };
    assert.equal(sessionHasActiveLlmContext(session), false);
});

test("sessionHasActiveLlmContext false for empty session", () => {
    assert.equal(sessionHasActiveLlmContext({ meta: {}, messages: [] }), false);
});

test("sessionHasActiveLlmContext true when messages follow divider index", () => {
    const session = {
        meta: { llmContextFromIndex: 1 },
        messages: [
            divider(CONTEXT_DIVIDER_LABEL),
            { id: "u1", role: "user", content: "active", runId: "run-1" },
        ],
    };
    assert.equal(sessionHasActiveLlmContext(session), true);
});

test("appendedMessagesNeedFullRender for context divider tail", () => {
    const messages = [
        { id: "u1", role: "user", content: "hi" },
        divider(CONTEXT_DIVIDER_LABEL),
    ];
    assert.equal(appendedMessagesNeedFullRender(messages, 1), true);
});

test("appendedMessagesNeedFullRender for hook-blocked assistant without user turn", () => {
    const messages = [
        { id: "u0", role: "user", content: "old", runId: "run-a" },
        { id: "a0", role: "assistant", content: "ok", runId: "run-a" },
        { id: "a1", role: "assistant", content: "blocked by hook", runId: "run-b" },
    ];
    assert.equal(appendedMessagesNeedFullRender(messages, 2), true);
});

test("appendedMessagesNeedFullRender false when assistant continues same run", () => {
    const messages = [
        { id: "u1", role: "user", content: "hi", runId: "run-1" },
        { id: "a1", role: "assistant", content: "reply", runId: "run-1" },
    ];
    assert.equal(appendedMessagesNeedFullRender(messages, 1), false);
});

test("appendedMessagesNeedFullRender for standalone assistant notice without runId", () => {
    const messages = [
        { id: "u1", role: "user", content: "hi", runId: "run-1" },
        { id: "a1", role: "assistant", content: "reply", runId: "run-1" },
        { id: "a2", role: "assistant", content: "当前上下文过短，暂无需压缩。" },
    ];
    assert.equal(appendedMessagesNeedFullRender(messages, 2), true);
});
