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
import {
    ensureSessionPlanFile,
    getPlanDisplayPath,
} from "../src/shared/sessionPlanPaths.js";

test("getPlanFilePath uses session storage directory", () => {
    const sessionsDir = "/tmp/.CRAgent/sessions";
    assert.equal(
        getPlanFilePath(sessionsDir, "sess-1"),
        path.join(sessionsDir, "sess-1", "plan.md"),
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
    const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-ws-"));
    const planFilePath = writePlanFile(sessionsDir, "s1", "# Plan", workspace);
    const err = validatePlanModeToolCall(
        "write_file",
        { path: "src/foo.ts", content: "x" },
        planFilePath,
        workspace,
        "s1",
    );
    assert.match(err, /only write the plan file/);
});

test("validatePlanModeToolCall accepts plan.md alias", () => {
    const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-alias-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-alias-ws-"));
    const planFilePath = writePlanFile(sessionsDir, "s1", "# Plan", workspace);
    const err = validatePlanModeToolCall(
        "write_file",
        { path: getPlanDisplayPath(), content: "# Plan\n" },
        planFilePath,
        workspace,
        "s1",
    );
    assert.equal(err, null);
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

test("writePlanFile persists markdown plan in session dir", () => {
    const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-write-"));
    const content = "# Plan\n\n- step one";
    const filePath = writePlanFile(sessionsDir, "s-write", content);
    assert.equal(fs.readFileSync(filePath, "utf-8"), content);
    assert.match(filePath, /s-write[\\/]plan\.md$/);
});

test("writePlanFile migrates legacy workspace plan", () => {
    const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-migrate-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-plan-migrate-ws-"));
    const legacyDir = path.join(workspace, ".cragent", "plans");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "legacy-s.md"), "# Legacy\n", "utf-8");
    const filePath = ensureSessionPlanFile(sessionsDir, "legacy-s", workspace);
    assert.equal(fs.readFileSync(filePath, "utf-8"), "# Legacy\n");
    assert.equal(fs.existsSync(path.join(legacyDir, "legacy-s.md")), false);
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
        planFilePath: "/data/sessions/s1/plan.md",
        planExists: false,
    });
    assert.match(prompt, /Plan Mode/);
    assert.match(prompt, /\/data\/sessions\/s1\/plan\.md/);
    assert.match(prompt, /read-only/i);
});
