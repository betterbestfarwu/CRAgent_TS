import fs from "node:fs";
import { getPlanDisplayPath, planFileExists } from "../planMode.js";
import { ensureSessionPlanFile } from "@shared/sessionPlanPaths.js";

function fnSchema(name, description, parameters) {
    return {
        type: "function",
        function: { name, description, parameters },
    };
}

export function createPlanModeTools({ configStore, sessionStore, resolveWorkspaceForSession }) {
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
                const sessionId = context?.sessionId;
                if (!sessionId) {
                    throw new Error("enter_plan_mode requires an active session");
                }
                const sessionsDir = sessionStore.locateSessionStorage(sessionId);
                const workspace = resolveWorkspaceForSession(sessionId);
                const planFilePath = ensureSessionPlanFile(sessionsDir, sessionId, workspace);
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
                const exists = planFileExists(sessionsDir, sessionId, workspace);
                return [
                    "Entered Plan mode.",
                    exists
                        ? `Continue editing the plan at: ${planFilePath}`
                        : `Create your plan at: ${planFilePath} (write_file path: ${getPlanDisplayPath()})`,
                    "Use read-only tools to explore; only the plan file may be written.",
                    "When ready, ask the user to approve the plan (开始执行).",
                ].join("\n");
            },
        },
    ];
}
