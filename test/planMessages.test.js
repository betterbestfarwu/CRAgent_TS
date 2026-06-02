import test from "node:test";
import assert from "node:assert/strict";
import { isPlanRejectionMessage, PLAN_REJECTION_PREFIX } from "../src/shared/planMessages.js";

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
