import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    buildExitPlanModeUserMessage,
    buildPlanRejectionUserMessage,
    buildPlanModeSystemPrompt,
    classifyBashForPlanMode,
    filterToolsForPlanMode,
    getPlanFilePath,
    validatePlanModeToolCall,
    writePlanFile,
} from "../src/main/planMode.js";
import { resolveShellRuntime } from "../src/main/bashSafety.js";

test("getPlanFilePath uses session-scoped markdown under workspace", () => {
    const workspace = "/tmp/project";
    assert.equal(
        getPlanFilePath(workspace, "sess-1"),
        path.join(workspace, ".cragent/plans", "sess-1.md"),
    );
});

test("filterToolsForPlanMode keeps read tools and write_file", () => {
    const tools = [
        { name: "read_file" },
        { name: "write_file" },
        { name: "TodoWrite" },
        { name: "Task" },
        { name: "mcp_foo" },
    ];
    const names = filterToolsForPlanMode(tools).map((t) => t.name);
    assert.deepEqual(names.sort(), ["read_file", "write_file"].sort());
});

test("validatePlanModeToolCall blocks writes outside plan file", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-"));
    const planFilePath = getPlanFilePath(workspace, "s1");
    const resolvePath = (_ws, rel) => path.join(workspace, rel);
    const err = validatePlanModeToolCall(
        "write_file",
        { path: "src/foo.ts", content: "x" },
        planFilePath,
        workspace,
        resolvePath,
    );
    assert.match(err, /only write the plan file/);
});

test("classifyBashForPlanMode blocks write-class commands", () => {
    let runtime;
    try {
        runtime = resolveShellRuntime();
    } catch {
        return;
    }
    const blocked = classifyBashForPlanMode("npm install lodash", runtime);
    assert.equal(blocked.kind, "blocked");
    const allowed = classifyBashForPlanMode("git status", runtime);
    assert.equal(allowed.kind, "allowed");
});

test("buildExitPlanModeUserMessage includes plan body", () => {
    const msg = buildExitPlanModeUserMessage("# Plan\n- step 1", "/tmp/plan.md");
    assert.match(msg, /已批准的计划/);
    assert.match(msg, /step 1/);
    assert.match(msg, /\/tmp\/plan\.md/);
});

test("writePlanFile persists markdown plan", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-write-"));
    const content = "# Plan\n\n- step one";
    const filePath = writePlanFile(workspace, "s-write", content);
    assert.equal(fs.readFileSync(filePath, "utf-8"), content);
});

test("buildPlanRejectionUserMessage includes prefix, plan, and feedback", () => {
    const msg = buildPlanRejectionUserMessage("# Draft\n- step A", "需要更多测试细节");
    assert.match(msg, /rejected by the user/i);
    assert.match(msg, /stay in plan mode/i);
    assert.match(msg, /# Draft/);
    assert.match(msg, /User feedback/);
    assert.match(msg, /需要更多测试细节/);
});

test("buildPlanModeSystemPrompt mentions plan file path", () => {
    const prompt = buildPlanModeSystemPrompt({
        planFilePath: "/proj/.cragent/plans/s1.md",
        planExists: false,
    });
    assert.match(prompt, /Plan Mode/);
    assert.match(prompt, /\/proj\/\.cragent\/plans\/s1\.md/);
    assert.match(prompt, /read-only/i);
});
