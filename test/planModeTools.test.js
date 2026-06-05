import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigStore } from "../src/main/configStore.js";
import { SessionStore } from "../src/main/sessionStore.js";
import { createPlanModeTools } from "../src/main/tools/planModeTools.js";
import { getPlanFilePath } from "../src/shared/sessionPlanPaths.js";

function createHarness(prefix = "cragent-plan-tool-") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const sessionsDir = path.join(dir, "sessions");
    const projectsDir = path.join(dir, "Projects");
    const configFile = path.join(dir, "config.json");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const configStore = new ConfigStore(configFile);
    const sessionStore = new SessionStore(
        sessionsDir,
        configStore.resolvePrimaryRef(),
        null,
        projectsDir,
    );
    const session = sessionStore.newSession();
    const tools = createPlanModeTools({
        sessionStore,
        resolveWorkspaceForSession: () => path.join(dir, "workspace"),
    });
    const enter = tools.find((tool) => tool.name === "enter_plan_mode");
    return { dir, session, sessionStore, enter };
}

function appendUserMessage(sessionStore, sessionId, content) {
    sessionStore.appendMessage(sessionId, {
        id: `u-${Date.now()}-${Math.random()}`,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
    });
}

describe("enter_plan_mode tool", () => {
    it("stores plan under session directory", async () => {
        const { session, sessionStore, enter } = createHarness();
        appendUserMessage(sessionStore, session.meta.id, "请进入计划模式，先只做计划");

        assert.equal(enter.enabledForSession(session.meta.id), true);
        await enter.execute({}, { sessionId: session.meta.id });
        const planPath = getPlanFilePath(
            sessionStore.locateSessionStorage(session.meta.id),
            session.meta.id,
        );
        assert.equal(fs.existsSync(planPath), false);
        assert.match(planPath, /plan\.md$/);
    });

    it("does not enable for prompt explanation requests", async () => {
        const { session, sessionStore, enter } = createHarness(
            "cragent-plan-tool-explain-",
        );
        const pastedPrompt = [
            "ABOUT BUILTABDUL:",
            "Generate my next LinkedIn post.",
            "Return only JSON in this format:",
            "{",
            '"about": "One-sentence summary",',
            '"copy": "Full LinkedIn post",',
            '"image": "Renaissance-style visual metaphor"',
            "}",
            "这个提示词是什么意思",
        ].join("\n");
        appendUserMessage(sessionStore, session.meta.id, pastedPrompt);

        assert.equal(enter.enabledForSession(session.meta.id), false);
        await assert.rejects(
            () => enter.execute({}, { sessionId: session.meta.id }),
            /explicitly asks to enter Plan Mode/,
        );
        assert.equal(sessionStore.get(session.meta.id).meta.executionMode, "goal");
    });
});
