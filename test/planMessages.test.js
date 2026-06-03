import test from "node:test";
import assert from "node:assert/strict";
import {
    isPlanRejectionMessage,
    PLAN_MODE_AUTO_SYSTEM_HINT,
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
