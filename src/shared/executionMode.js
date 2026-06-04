export const EXECUTION_MODES = {
    plan: {
        id: "plan",
        label: "计划模式",
    },
    goal: {
        id: "goal",
        label: "追求模式",
    },
};

export const EXECUTION_MODE_IDS = Object.keys(EXECUTION_MODES);

export function normalizeExecutionMode(value, fallback = "goal") {
    if (value === "plan") {
        return "plan";
    }
    if (fallback === "plan") {
        return "plan";
    }
    return "goal";
}
