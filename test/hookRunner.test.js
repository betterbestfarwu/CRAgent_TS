import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HookRunner } from "../src/main/hooks/hookRunner.js";

describe("HookRunner", () => {
    it("runs a command hook and blocks on exit code 2", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-hooks-"));
        fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
        const scriptPath = path.join(root, "hooks", "block-prompt.sh");
        fs.writeFileSync(
            scriptPath,
            `#!/bin/bash
input=$(cat)
if echo "$input" | grep -q '"blocked-test"'; then
  echo '{"decision":"block","reason":"test block"}' >&2
  exit 2
fi
echo '{}'
`,
            { mode: 0o755 },
        );
        fs.writeFileSync(
            path.join(root, "hooks.json"),
            JSON.stringify({
                version: 1,
                hooks: {
                    UserPromptSubmit: [{ command: "hooks/block-prompt.sh" }],
                },
            }),
        );

        const runner = new HookRunner({
            getHooksConfig: () => ({
                hooksFile: path.join(root, "hooks.json"),
                hookRoot: root,
            }),
            getSessionMeta: () => ({
                transcriptPath: path.join(root, "session.json"),
                cwd: root,
                permissionMode: "default",
            }),
        });

        const blocked = await runner.run(
            "UserPromptSubmit",
            runner.buildBaseInput("sess-1", "UserPromptSubmit", {
                prompt: "blocked-test",
            }),
        );
        assert.equal(blocked.blocked, true);
        assert.match(blocked.reason, /test block|blocked/i);

        const allowed = await runner.run(
            "UserPromptSubmit",
            runner.buildBaseInput("sess-1", "UserPromptSubmit", {
                prompt: "hello",
            }),
        );
        assert.equal(allowed.blocked, undefined);
    });

    it("applies PreToolUse updated_input from hook stdout", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-hooks-"));
        fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
        fs.writeFileSync(
            path.join(root, "hooks", "rewrite.sh"),
            `#!/bin/bash
echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"path":"rewritten.txt"}}}'
`,
            { mode: 0o755 },
        );
        fs.writeFileSync(
            path.join(root, "hooks.json"),
            JSON.stringify({
                version: 1,
                hooks: {
                    PreToolUse: [{ command: "hooks/rewrite.sh", matcher: "read_file" }],
                },
            }),
        );

        const runner = new HookRunner({
            getHooksConfig: () => ({
                hooksFile: path.join(root, "hooks.json"),
                hookRoot: root,
            }),
            getSessionMeta: () => ({
                transcriptPath: path.join(root, "session.json"),
                cwd: root,
                permissionMode: "default",
            }),
        });

        const result = await runner.run(
            "PreToolUse",
            runner.buildBaseInput("sess-2", "PreToolUse", {
                tool_name: "read_file",
                tool_input: { path: "original.txt" },
                tool_use_id: "call-1",
            }),
            { matchQuery: "read_file" },
        );
        assert.deepEqual(result.updatedInput, { path: "rewritten.txt" });
    });

    it("isEnabled=false skips hook execution", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-hooks-off-"));
        fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
        fs.writeFileSync(
            path.join(root, "hooks", "block.sh"),
            `#!/bin/bash
echo '{"decision":"block"}' >&2
exit 2
`,
            { mode: 0o755 },
        );
        fs.writeFileSync(
            path.join(root, "hooks.json"),
            JSON.stringify({
                version: 1,
                hooks: { UserPromptSubmit: [{ command: "hooks/block.sh" }] },
            }),
        );

        const runner = new HookRunner({
            getHooksConfig: () => ({
                hooksFile: path.join(root, "hooks.json"),
                hookRoot: root,
            }),
            getSessionMeta: () => ({
                transcriptPath: path.join(root, "s.json"),
                cwd: root,
                permissionMode: "default",
            }),
            isEnabled: () => false,
        });

        const result = await runner.run(
            "UserPromptSubmit",
            runner.buildBaseInput("s", "UserPromptSubmit", { prompt: "x" }),
        );
        assert.equal(result.blocked, undefined);
    });
});
