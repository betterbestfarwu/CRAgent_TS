import assert from "node:assert/strict";
import test from "node:test";

function resolvePlanApproval(payload) {
    const { approved, cancelled, dismissed, rejected, content, feedback } = payload || {};
    return {
        approved: Boolean(approved),
        cancelled: Boolean(cancelled),
        dismissed: Boolean(dismissed) || Boolean(cancelled),
        rejected: Boolean(rejected),
        content: typeof content === "string" ? content : undefined,
        feedback: typeof feedback === "string" ? feedback : undefined,
    };
}

function exitPlanModeResult(approval) {
    if (approval.dismissed || approval.cancelled) {
        return { dismissed: true };
    }
    if (approval.rejected || !approval.approved) {
        return { rejected: true, ranRejectPlanMode: true };
    }
    return { approved: true };
}

test("dismissed plan approval does not continue planning", () => {
    const approval = resolvePlanApproval({ dismissed: true });
    assert.equal(approval.dismissed, true);
    assert.equal(approval.rejected, false);
    assert.equal(approval.approved, false);

    const result = exitPlanModeResult(approval);
    assert.deepEqual(result, { dismissed: true });
});

test("rejected plan approval continues planning", () => {
    const approval = resolvePlanApproval({
        rejected: true,
        content: "# Plan",
        feedback: "add tests",
    });
    assert.equal(approval.rejected, true);
    assert.equal(approval.dismissed, false);

    const result = exitPlanModeResult(approval);
    assert.deepEqual(result, { rejected: true, ranRejectPlanMode: true });
});

test("legacy cancelled flag is treated as dismissed", () => {
    const approval = resolvePlanApproval({ cancelled: true });
    assert.equal(approval.dismissed, true);
    assert.deepEqual(exitPlanModeResult(approval), { dismissed: true });
});
