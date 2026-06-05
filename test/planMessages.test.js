import test from "node:test";
import assert from "node:assert/strict";
import {
    isPlanRejectionMessage,
    parsePlanRejectionDisplay,
    PLAN_REJECTION_FOOTER,
    PLAN_REJECTION_PREFIX,
} from "../src/shared/planMessages.js";

test("isPlanRejectionMessage detects flag and prefix", () => {
    assert.equal(isPlanRejectionMessage({ role: "user", planRejection: true }), true);
    assert.equal(
        isPlanRejectionMessage({
            role: "user",
            content: `${PLAN_REJECTION_PREFIX}# Plan`,
        }),
        true,
    );
    assert.equal(isPlanRejectionMessage({ role: "user", content: "hello" }), false);
    assert.equal(isPlanRejectionMessage({ role: "assistant", planRejection: true }), false);
});

test("parsePlanRejectionDisplay extracts plan and feedback for UI", () => {
    const plan = "## Plan\n\n- **item**";
    const feedback = "add tests";
    const content =
        `${PLAN_REJECTION_PREFIX}${plan}\n\nUser feedback:\n${feedback}${PLAN_REJECTION_FOOTER}`;
    assert.deepEqual(parsePlanRejectionDisplay(content), { plan, feedback });
    assert.deepEqual(parsePlanRejectionDisplay(`${PLAN_REJECTION_PREFIX}${plan}${PLAN_REJECTION_FOOTER}`), {
        plan,
        feedback: "",
    });
});

