export const PLAN_REJECTION_PREFIX =
    "The agent proposed a plan that was rejected by the user. The user chose to stay in plan mode rather than proceed with implementation.\n\nRejected plan:\n";

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
