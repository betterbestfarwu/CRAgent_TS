export const PLAN_REJECTION_PREFIX =
    "The agent proposed a plan that was rejected by the user. The user chose to stay in plan mode rather than proceed with implementation.\n\nRejected plan:\n";

export const PLAN_REJECTION_FEEDBACK_MARKER = "\n\nUser feedback:\n";

export const PLAN_REJECTION_FOOTER =
    "\n\nStay in plan mode. Update the plan file to address the feedback. Do not implement code changes until the user approves execution.";

/** Extract plan markdown and optional feedback for UI display (wire message is unchanged). */
export function parsePlanRejectionDisplay(content) {
    const text = String(content || "");
    if (!text.startsWith(PLAN_REJECTION_PREFIX)) {
        return { plan: text.trim(), feedback: "" };
    }
    let body = text.slice(PLAN_REJECTION_PREFIX.length);
    if (body.endsWith(PLAN_REJECTION_FOOTER)) {
        body = body.slice(0, -PLAN_REJECTION_FOOTER.length);
    } else {
        const footerIdx = body.indexOf("\n\nStay in plan mode.");
        if (footerIdx >= 0) {
            body = body.slice(0, footerIdx);
        }
    }
    let feedback = "";
    const feedbackIdx = body.indexOf(PLAN_REJECTION_FEEDBACK_MARKER);
    if (feedbackIdx >= 0) {
        feedback = body.slice(feedbackIdx + PLAN_REJECTION_FEEDBACK_MARKER.length).trim();
        body = body.slice(0, feedbackIdx);
    }
    return { plan: body.trim(), feedback };
}

/** Shown in the user bubble when a delivery-style request auto-enters plan mode. */
export const PLAN_MODE_AUTO_SYSTEM_HINT =
    "系统提示：该请求看起来是项目落地型任务，已自动进入 Plan Mode。请先只做只读探索并编写计划文件；计划获批后再开始实现。";

export function splitPlanModeAutoSystemHint(content) {
    const text = String(content || "");
    const marker = `\n\n${PLAN_MODE_AUTO_SYSTEM_HINT}`;
    if (text.endsWith(marker)) {
        return { userText: text.slice(0, -marker.length), systemHint: PLAN_MODE_AUTO_SYSTEM_HINT };
    }
    const idx = text.indexOf(PLAN_MODE_AUTO_SYSTEM_HINT);
    if (idx >= 0) {
        return {
            userText: text.slice(0, idx).trimEnd(),
            systemHint: PLAN_MODE_AUTO_SYSTEM_HINT,
        };
    }
    return { userText: text, systemHint: null };
}

export function isPlanRejectionMessage(message) {
    if (!message || message.role !== "user") {
        return false;
    }
    if (message.planRejection === true) {
        return true;
    }
    const content = String(message.content || "");
    return content.startsWith(PLAN_REJECTION_PREFIX);
}
