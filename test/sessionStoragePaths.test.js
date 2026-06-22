import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
    goalModeBashBlocksWorkspaceCragent,
    resolveSessionStorageToolPath,
} from "../src/shared/sessionStoragePaths.js";
import { getPlanFilePath } from "../src/shared/sessionPlanPaths.js";

describe("sessionStoragePaths", () => {
    it("redirects workspace .cragent/plans to session plan.md", () => {
        const workspace = "/proj";
        const sessionsDir = "/data/sessions/projects-root/p1";
        const sessionId = "s1";
        const target = resolveSessionStorageToolPath(".cragent/plans/s1.md", {
            workspace,
            sessionsDir,
            sessionId,
        });
        assert.equal(target, getPlanFilePath(sessionsDir, sessionId));
    });

    it("redirects other .cragent paths under session directory", () => {
        const workspace = "/proj";
        const sessionsDir = "/data/sessions/projects-root/p1";
        const sessionId = "s1";
        const target = resolveSessionStorageToolPath(".cragent/notes/task.md", {
            workspace,
            sessionsDir,
            sessionId,
        });
        assert.equal(
            target,
            path.join(sessionsDir, sessionId, "notes", "task.md"),
        );
    });

    it("writes redirected file to disk via goal mode path", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-storage-path-"));
        const workspace = path.join(dir, "workspace");
        const sessionsDir = path.join(dir, "sessions", "projects-root", "p1");
        fs.mkdirSync(workspace, { recursive: true });
        const sessionId = "sess-1";
        const target = resolveSessionStorageToolPath(".cragent/tasks/out.md", {
            workspace,
            sessionsDir,
            sessionId,
        });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "ok", "utf-8");
        assert.equal(
            fs.readFileSync(
                path.join(sessionsDir, sessionId, "tasks", "out.md"),
                "utf-8",
            ),
            "ok",
        );
        assert.equal(fs.existsSync(path.join(workspace, ".cragent", "tasks", "out.md")), false);
    });

    it("blocks goal mode bash writes targeting .cragent", () => {
        assert.match(
            goalModeBashBlocksWorkspaceCragent("echo hi > .cragent/out.txt"),
            /禁止向工作区 .cragent/,
        );
        assert.match(
            goalModeBashBlocksWorkspaceCragent("echo hi > .cragent/out.txt"),
            /~\/\.CRAgent\/sessions\/<projectsRootGuid>\/<projectId>\/<sessionId>/,
        );
        assert.equal(goalModeBashBlocksWorkspaceCragent("ls .cragent"), null);
    });
});
