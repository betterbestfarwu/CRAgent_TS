import { getPlanDisplayPath, planFileExists } from "../planMode.js";
import { ensureSessionPlanFile } from "@shared/sessionPlanPaths.js";
import { normalizeExecutionMode } from "@shared/executionMode.js";

const EXPLICIT_PLAN_MODE_PATTERNS = [
    /^\/plan(?:\s|$)/i,
    /(?:^|[\s，。,.!！?？、])(?:请|帮我|麻烦)?\s*(?:进入|切换到|切换成|切到|开启|启用|打开|使用)\s*(?:plan\s*mode|plan\s*模式|计划模式)(?:[\s，。,.!！?？、]|$)/i,
    /(?:^|[\s，。,.!！?？、])(?:please\s+)?(?:enter|switch\s+to|turn\s+on|enable|use)\s+(?:plan|planning)\s+mode\b/i,
    /^(?:请|帮我|麻烦)?\s*(?:plan\s*mode|plan\s*模式|计划模式)\s*$/i,
];

function fnSchema(name, description, parameters) {
    return {
        type: "function",
        function: { name, description, parameters },
    };
}

function planModeIntentText(content) {
    const text = String(content || "").trim();
    if (text.length <= 500) {
        return text;
    }
    const lines = text
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean);
    return [lines[0], lines.at(-1)].filter(Boolean).join("\n");
}

export function isExplicitPlanModeRequest(content) {
    const intentText = planModeIntentText(content);
    if (!intentText) {
        return false;
    }
    return EXPLICIT_PLAN_MODE_PATTERNS.some((pattern) => pattern.test(intentText));
}

function latestUserMessageContent(session) {
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
        const message = session.messages[index];
        if (message?.role === "user") {
            return message.userText ?? message.content ?? "";
        }
    }
    return "";
}

function canEnterPlanMode(sessionStore, sessionId) {
    if (!sessionId) {
        return false;
    }
    const session = sessionStore.get(sessionId, {
        messageLimit: 20,
        hydrateImages: false,
    });
    if (normalizeExecutionMode(session.meta.executionMode) === "plan") {
        return false;
    }
    return isExplicitPlanModeRequest(latestUserMessageContent(session));
}

export function createPlanModeTools({ sessionStore, resolveWorkspaceForSession }) {
    return [
        {
            name: "enter_plan_mode",
            requiresConfirmation: false,
            enabled: () => true,
            enabledForSession(sessionId) {
                if (!sessionId) {
                    return false;
                }
                try {
                    return canEnterPlanMode(sessionStore, sessionId);
                } catch {
                    return false;
                }
            },
            schema: fnSchema(
                "enter_plan_mode",
                "Switch to Plan mode only when the user's latest message explicitly requests Plan Mode. Do not use for ordinary questions, explanations, summaries, translations, or implementation requests.",
                { type: "object", properties: {}, additionalProperties: false },
            ),
            async execute(_args, context) {
                const sessionId = context?.sessionId;
                if (!sessionId) {
                    throw new Error("enter_plan_mode requires an active session");
                }
                if (!canEnterPlanMode(sessionStore, sessionId)) {
                    throw new Error(
                        "enter_plan_mode is only available when the latest user message explicitly asks to enter Plan Mode",
                    );
                }
                const sessionsDir = sessionStore.locateSessionStorage(sessionId);
                const workspace = resolveWorkspaceForSession(sessionId);
                const planFilePath = ensureSessionPlanFile(sessionsDir, sessionId, workspace);
                sessionStore.updateExecutionMode(sessionId, "plan");
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
