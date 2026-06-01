import test from "node:test";
import assert from "node:assert/strict";
import {
    CONTEXT_COMPACT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_ROLE,
    dedupeConsecutiveContextDividers,
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
