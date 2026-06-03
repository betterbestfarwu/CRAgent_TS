import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigStore } from "../src/main/configStore.js";
import { SessionStore } from "../src/main/sessionStore.js";
import { createPlanModeTools } from "../src/main/tools/planModeTools.js";
import { getPlanFilePath } from "../src/shared/sessionPlanPaths.js";

describe("enter_plan_mode tool", () => {
    it("stores plan under session directory", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-tool-"));
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
            configStore,
            sessionStore,
            resolveWorkspaceForSession: () => path.join(dir, "workspace"),
        });
        const enter = tools.find((tool) => tool.name === "enter_plan_mode");
        await enter.execute({}, { sessionId: session.meta.id });
        const planPath = getPlanFilePath(
            sessionStore.locateSessionStorage(session.meta.id),
            session.meta.id,
        );
        assert.equal(fs.existsSync(planPath), false);
        assert.match(planPath, /plan\.md$/);
    });
});
