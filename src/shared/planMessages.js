export const PLAN_REJECTION_PREFIX =
    "The agent proposed a plan that was rejected by the user. The user chose to stay in plan mode rather than proceed with implementation.\n\nRejected plan:\n";

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
