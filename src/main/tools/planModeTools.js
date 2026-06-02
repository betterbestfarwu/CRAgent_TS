import { getPlanFilePath, planFileExists, ensurePlansDirectory } from "../planMode.js";

function fnSchema(name, description, parameters) {
    return {
        type: "function",
        function: { name, description, parameters },
    };
}

export function createPlanModeTools({ getAgentWorkspace, configStore, sessionIdFromContext }) {
    return [
        {
            name: "enter_plan_mode",
            requiresConfirmation: false,
            enabled: () => configStore.get().agents?.default?.execution_mode !== "plan",
            schema: fnSchema(
                "enter_plan_mode",
                "Switch to Plan mode for read-only exploration and planning before implementation. Use when the task is large, ambiguous, or needs design before coding.",
                { type: "object", properties: {}, additionalProperties: false },
            ),
            async execute(_args, context) {
                const sessionId = context?.sessionId || sessionIdFromContext?.();
                if (!sessionId) {
                    throw new Error("enter_plan_mode requires an active session");
                }
                const workspace = getAgentWorkspace(sessionId);
                ensurePlansDirectory(workspace);
                const planFilePath = getPlanFilePath(workspace, sessionId);
                const config = configStore.get();
                configStore.update({
                    ...config,
                    agents: {
                        ...config.agents,
                        default: {
                            ...(config.agents?.default || {}),
                            execution_mode: "plan",
                        },
                    },
                });
                const exists = planFileExists(workspace, sessionId);
                return [
                    "Entered Plan mode.",
                    exists
                        ? `Continue editing the plan at: ${planFilePath}`
                        : `Create your plan at: ${planFilePath}`,
                    "Use read-only tools to explore; only the plan file may be written.",
                    "When ready, ask the user to approve the plan (开始执行).",
                ].join("\n");
            },
        },
    ];
}
