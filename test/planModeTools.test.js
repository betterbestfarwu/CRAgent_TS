import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigStore } from "../src/main/configStore.js";
import { createPlanModeTools } from "../src/main/tools/planModeTools.js";
import { getPlanFilePath, planFileExists } from "../src/main/planMode.js";

test("enter_plan_mode tool switches execution_mode to plan", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-tool-"));
    const configStore = new ConfigStore(path.join(dir, "config.json"));
    const workspace = path.join(dir, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const [tool] = createPlanModeTools({
        getAgentWorkspace: () => workspace,
        configStore,
    });
    assert.equal(tool.name, "enter_plan_mode");
    assert.equal(configStore.get().agents.default.execution_mode, "goal");

    const result = await tool.execute({}, { sessionId: "sess-enter" });
    assert.match(result, /Plan mode/i);
    assert.equal(configStore.get().agents.default.execution_mode, "plan");
    assert.equal(planFileExists(workspace, "sess-enter"), false);
    assert.equal(getPlanFilePath(workspace, "sess-enter").includes(".cragent/plans"), true);
});

test("enter_plan_mode is disabled while already in plan mode", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-tool-"));
    const configStore = new ConfigStore(path.join(dir, "config.json"));
    configStore.update({
        ...configStore.get(),
        agents: {
            ...configStore.get().agents,
            default: { ...configStore.get().agents.default, execution_mode: "plan" },
        },
    });
    const [tool] = createPlanModeTools({
        getAgentWorkspace: () => dir,
        configStore,
    });
    assert.equal(tool.enabled(), false);
});
