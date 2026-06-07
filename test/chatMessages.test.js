import test from "node:test";
import assert from "node:assert/strict";
import {
    appendedMessagesNeedFullRender,
    collectMessagesUpToTurn,
    CONTEXT_COMPACT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_ROLE,
    dedupeConsecutiveContextDividers,
    excludeUnpairedAssistantAndToolMessages,
    mergeAdjacentSameContentUserMessages,
    normalizeMessagesForLlm,
    padMissingAssistantsBetweenUsers,
    reconcileLlmContextAfterMessageRemoval,
    removeAdjacentDuplicateContextDividers,
    normalizeLlmContextMeta,
    getActiveLlmContextStartIndex,
    sessionHasActiveLlmContext,
    stableUserWireMessage,
    userImagesWireFingerprint,
} from "../src/shared/chatMessages.js";

function divider(content, id = `d-${content}`) {
    return { id, role: CONTEXT_DIVIDER_ROLE, content };
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
    const dividerMessage = divider(CONTEXT_DIVIDER_LABEL, "d1");
    const session = {
        meta: { llmContextDividerId: "d1" },
        messages: [
            { id: "u1", role: "user", content: "old" },
            dividerMessage,
        ],
    };
    assert.equal(sessionHasActiveLlmContext(session), false);
});

test("sessionHasActiveLlmContext false for empty session", () => {
    assert.equal(sessionHasActiveLlmContext({ meta: {}, messages: [] }), false);
});

test("sessionHasActiveLlmContext true when messages follow divider", () => {
    const dividerMessage = divider(CONTEXT_DIVIDER_LABEL, "d1");
    const session = {
        meta: { llmContextDividerId: "d1" },
        messages: [
            dividerMessage,
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

test("userImagesWireFingerprint ignores transient data_url and image_src", () => {
    const previous = [
        {
            id: "u1",
            role: "user",
            images: [
                {
                    index: 0,
                    has_data: true,
                    image_file: "u1-0.png",
                    data_url: "data:image/png;base64,AAA",
                },
            ],
        },
    ];
    const next = [
        {
            id: "u1",
            role: "user",
            images: [
                {
                    index: 0,
                    has_data: true,
                    image_file: "u1-0.png",
                    image_src: "cragent-session://local/s1/u1-0.png",
                },
            ],
        },
    ];
    assert.equal(userImagesWireFingerprint(previous), userImagesWireFingerprint(next));
});

test("stableUserWireMessage drops transient image payloads", () => {
    const wire = {
        id: "u1",
        role: "user",
        content: "pic",
        images: [
            {
                index: 0,
                mime_type: "image/png",
                has_data: true,
                image_file: "u1-0.png",
                data_url: "data:image/png;base64,AAA",
                image_src: "cragent-session://local/s1/u1-0.png",
            },
        ],
    };
    assert.deepEqual(stableUserWireMessage(wire), {
        id: "u1",
        role: "user",
        content: "pic",
        images: [{ index: 0, mime_type: "image/png", has_data: true, image_file: "u1-0.png" }],
    });
});

test("collectMessagesUpToTurn keeps only prefix through selected turn", () => {
    const messages = [
        { id: "u1", role: "user", content: "one", runId: "run-1" },
        { id: "a1", role: "assistant", content: "two", runId: "run-1" },
        { id: "u2", role: "user", content: "three", runId: "run-2" },
        { id: "a2", role: "assistant", content: "four", runId: "run-2" },
    ];
    assert.deepEqual(
        collectMessagesUpToTurn(messages, "a1").map((message) => message.id),
        ["u1", "a1"],
    );
});

test("reconcileLlmContextAfterMessageRemoval keeps llmContextDividerId when deleting before divider", () => {
    const dividerMessage = {
        id: "d1",
        role: CONTEXT_DIVIDER_ROLE,
        content: CONTEXT_DIVIDER_LABEL,
    };
    const session = {
        meta: { llmContextDividerId: "d1" },
        messages: [
            { id: "u1", role: "user", content: "old" },
            dividerMessage,
            { id: "u2", role: "user", content: "new", runId: "run-1" },
        ],
    };
    session.messages = session.messages.filter((message) => message.id !== "u1");
    reconcileLlmContextAfterMessageRemoval(session);
    assert.equal(session.meta.llmContextDividerId, "d1");
    assert.equal(getActiveLlmContextStartIndex(session), 1);
    assert.equal(dividerMessage.llmContextFromIndex, undefined);
});

test("reconcileLlmContextAfterMessageRemoval clears meta when dividers removed", () => {
    const session = {
        meta: {
            llmContextDividerId: "d-old",
            contextSummary: "old summary",
            postCompactContext: "restored",
        },
        messages: [{ id: "u1", role: "user", content: "only message" }],
    };
    reconcileLlmContextAfterMessageRemoval(session);
    assert.equal(session.meta.llmContextDividerId, undefined);
    assert.equal(session.meta.contextSummary, undefined);
    assert.equal(session.meta.postCompactContext, undefined);
});

test("reconcileLlmContextAfterMessageRemoval keeps compact divider metadata", () => {
    const dividerMessage = {
        id: "d1",
        role: CONTEXT_DIVIDER_ROLE,
        content: CONTEXT_COMPACT_DIVIDER_LABEL,
        contextSummary: "compressed summary",
        postCompactContext: "file context",
    };
    const session = {
        meta: { llmContextDividerId: "d1" },
        messages: [
            { id: "u1", role: "user", content: "old" },
            dividerMessage,
            { id: "u2", role: "user", content: "new" },
        ],
    };
    reconcileLlmContextAfterMessageRemoval(session);
    assert.equal(session.meta.llmContextDividerId, "d1");
    assert.equal(session.meta.contextSummary, "compressed summary");
    assert.equal(session.meta.postCompactContext, "file context");
});

test("reconcileLlmContextAfterMessageRemoval removes orphan dividers", () => {
    const session = {
        meta: {
            llmContextFromIndex: 2,
            contextSummary: "summary",
            postCompactContext: "restored",
            sessionMemory: "memory",
            sessionMemoryUpToIndex: 1,
            recentFiles: ["a.js"],
            compactFailures: 2,
        },
        messages: [
            {
                id: "d1",
                role: CONTEXT_DIVIDER_ROLE,
                content: CONTEXT_DIVIDER_LABEL,
                llmContextFromIndex: 5,
            },
            {
                id: "d2",
                role: CONTEXT_DIVIDER_ROLE,
                content: CONTEXT_COMPACT_DIVIDER_LABEL,
                llmContextFromIndex: 6,
                contextSummary: "summary",
            },
        ],
    };
    reconcileLlmContextAfterMessageRemoval(session);
    assert.deepEqual(session.messages, []);
    assert.equal(session.meta.llmContextDividerId, undefined);
    assert.equal(session.meta.contextSummary, undefined);
    assert.equal(session.meta.postCompactContext, undefined);
    assert.equal(session.meta.sessionMemory, undefined);
    assert.equal(session.meta.recentFiles, undefined);
    assert.equal(session.meta.compactFailures, 0);
});

test("removeAdjacentDuplicateContextDividers drops later adjacent divider", () => {
    const messages = [
        {
            id: "d1",
            role: CONTEXT_DIVIDER_ROLE,
            content: CONTEXT_DIVIDER_LABEL,
        },
        {
            id: "d2",
            role: CONTEXT_DIVIDER_ROLE,
            content: CONTEXT_COMPACT_DIVIDER_LABEL,
            contextSummary: "summary",
        },
        { id: "u1", role: "user", content: "after" },
    ];
    const deduped = removeAdjacentDuplicateContextDividers(messages);
    assert.deepEqual(
        deduped.map((message) => message.id),
        ["d1", "u1"],
    );
});

test("removeAdjacentDuplicateContextDividers collapses three adjacent dividers", () => {
    const messages = [
        { id: "d1", role: CONTEXT_DIVIDER_ROLE, content: CONTEXT_DIVIDER_LABEL },
        { id: "d2", role: CONTEXT_DIVIDER_ROLE, content: CONTEXT_COMPACT_DIVIDER_LABEL },
        { id: "d3", role: CONTEXT_DIVIDER_ROLE, content: CONTEXT_DIVIDER_LABEL },
        { id: "u1", role: "user", content: "after" },
    ];
    const deduped = removeAdjacentDuplicateContextDividers(messages);
    assert.deepEqual(
        deduped.map((message) => message.id),
        ["d1", "u1"],
    );
});

test("reconcileLlmContextAfterMessageRemoval dedupes adjacent dividers and updates meta", () => {
    const session = {
        meta: {
            llmContextDividerId: "d2",
            contextSummary: "summary",
            postCompactContext: "restored",
        },
        messages: [
            { id: "u1", role: "user", content: "old" },
            {
                id: "d1",
                role: CONTEXT_DIVIDER_ROLE,
                content: CONTEXT_DIVIDER_LABEL,
            },
            {
                id: "d2",
                role: CONTEXT_DIVIDER_ROLE,
                content: CONTEXT_COMPACT_DIVIDER_LABEL,
                contextSummary: "summary",
                postCompactContext: "restored",
            },
            { id: "u2", role: "user", content: "new" },
        ],
    };
    reconcileLlmContextAfterMessageRemoval(session);
    assert.deepEqual(
        session.messages.map((message) => message.id),
        ["u1", "d1", "u2"],
    );
    assert.equal(session.meta.llmContextDividerId, "d1");
    assert.equal(session.meta.contextSummary, undefined);
    assert.equal(session.meta.postCompactContext, undefined);
});

test("normalizeLlmContextMeta migrates legacy llmContextFromIndex to divider id", () => {
    const dividerMessage = {
        id: "d1",
        role: CONTEXT_DIVIDER_ROLE,
        content: CONTEXT_DIVIDER_LABEL,
        llmContextFromIndex: 2,
    };
    const meta = { llmContextFromIndex: 2 };
    const messages = [
        { id: "u1", role: "user", content: "old" },
        dividerMessage,
        { id: "u2", role: "user", content: "new" },
    ];
    normalizeLlmContextMeta(meta, messages);
    assert.equal(meta.llmContextDividerId, "d1");
    assert.equal(meta.llmContextFromIndex, undefined);
    assert.equal(dividerMessage.llmContextFromIndex, undefined);
});

test("mergeAdjacentSameContentUserMessages collapses duplicate adjacent users", () => {
    const messages = [
        { id: "u1", role: "user", content: "hello", runId: "run-a" },
        { id: "u2", role: "user", content: "hello", runId: "run-b" },
        { id: "u3", role: "user", content: "next" },
    ];
    const merged = mergeAdjacentSameContentUserMessages(messages);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].id, "u1");
    assert.equal(merged[1].id, "u3");
});

test("mergeAdjacentSameContentUserMessages keeps different adjacent users", () => {
    const messages = [
        { id: "u1", role: "user", content: "one" },
        { id: "u2", role: "user", content: "two" },
    ];
    assert.equal(mergeAdjacentSameContentUserMessages(messages).length, 2);
});

test("padMissingAssistantsBetweenUsers inserts empty assistant between users", () => {
    const padded = padMissingAssistantsBetweenUsers([
        { id: "u1", role: "user", content: "one", runId: "run-1" },
        { id: "u2", role: "user", content: "two", runId: "run-2" },
    ]);
    assert.deepEqual(
        padded.map((message) => [message.role, message.content]),
        [
            ["user", "one"],
            ["assistant", ""],
            ["user", "two"],
        ],
    );
});

test("padMissingAssistantsBetweenUsers does not pad after trailing user", () => {
    const padded = padMissingAssistantsBetweenUsers([
        { id: "u1", role: "user", content: "one", runId: "run-1" },
        { id: "a1", role: "assistant", content: "ok", runId: "run-1" },
        { id: "u2", role: "user", content: "two", runId: "run-2" },
    ]);
    assert.equal(padded.length, 3);
    assert.equal(padded[padded.length - 1].role, "user");
});

test("excludeUnpairedAssistantAndToolMessages drops orphan assistant and tool", () => {
    const filtered = excludeUnpairedAssistantAndToolMessages([
        { id: "a1", role: "assistant", content: "blocked by hook", runId: "run-b" },
        { id: "a2", role: "assistant", content: "compact notice" },
        { id: "t1", role: "tool", name: "read_file", toolCallId: "call-1", content: "x", runId: "run-c" },
        { id: "u1", role: "user", content: "hi", runId: "run-1" },
        { id: "a3", role: "assistant", content: "ok", runId: "run-1" },
        { id: "t2", role: "tool", name: "read_file", toolCallId: "call-2", content: "y", runId: "run-1" },
    ]);
    assert.deepEqual(
        filtered.map((message) => message.id),
        ["u1", "a3", "t2"],
    );
});

test("normalizeMessagesForLlm applies exclude, merge, and pad in order", () => {
    const normalized = normalizeMessagesForLlm([
        { id: "u1", role: "user", content: "same", runId: "run-1" },
        { id: "u2", role: "user", content: "same", runId: "run-2" },
        { id: "a1", role: "assistant", content: "blocked", runId: "run-3" },
        { id: "u3", role: "user", content: "next", runId: "run-4" },
    ]);
    assert.deepEqual(
        normalized.map((message) => [message.role, message.content]),
        [
            ["user", "same"],
            ["assistant", ""],
            ["user", "next"],
        ],
    );
});
