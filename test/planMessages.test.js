import test from "node:test";
import assert from "node:assert/strict";
import {
    isPlanRejectionMessage,
    parsePlanRejectionDisplay,
    PLAN_MODE_AUTO_SYSTEM_HINT,
    PLAN_REJECTION_FOOTER,
    PLAN_REJECTION_PREFIX,
    splitPlanModeAutoSystemHint,
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

test("splitPlanModeAutoSystemHint separates user text from auto plan notice", () => {
    const userText = "帮我开发一个健身打卡的微信小程序";
    const combined = `${userText}\n\n${PLAN_MODE_AUTO_SYSTEM_HINT}`;
    const split = splitPlanModeAutoSystemHint(combined);
    assert.equal(split.userText, userText);
    assert.equal(split.systemHint, PLAN_MODE_AUTO_SYSTEM_HINT);
    assert.deepEqual(splitPlanModeAutoSystemHint(userText), {
        userText,
        systemHint: null,
    });
});
