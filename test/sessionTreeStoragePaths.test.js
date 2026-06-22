import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    ensureSessionTreeLayout,
    legacyProjectsStorageRoot,
    projectSessionsDir,
    projectTreeRootDir,
    sessionTreeLayoutFile,
    standaloneSessionsDir,
} from "../src/shared/sessionTreeStoragePaths.js";

describe("sessionTreeStoragePaths", () => {
    it("creates stable GUID roots under sessions", () => {
        const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-tree-paths-"));

        const layout = ensureSessionTreeLayout(sessionsDir);

        assert.match(layout.sessionsRootId, /^[0-9a-f-]{36}$/i);
        assert.match(layout.projectsRootId, /^[0-9a-f-]{36}$/i);
        assert.notEqual(layout.sessionsRootId, layout.projectsRootId);
        assert.equal(fs.existsSync(sessionTreeLayoutFile(sessionsDir)), true);
        assert.equal(ensureSessionTreeLayout(sessionsDir).sessionsRootId, layout.sessionsRootId);
        assert.equal(ensureSessionTreeLayout(sessionsDir).projectsRootId, layout.projectsRootId);
    });

    it("derives standalone and project hierarchy paths", () => {
        const sessionsDir = "/data/.CRAgent/sessions";
        const layout = { sessionsRootId: "sessions-root", projectsRootId: "projects-root" };

        assert.equal(
            standaloneSessionsDir(sessionsDir, layout),
            path.join(sessionsDir, "sessions-root"),
        );
        assert.equal(
            projectTreeRootDir(sessionsDir, layout),
            path.join(sessionsDir, "projects-root"),
        );
        assert.equal(
            projectSessionsDir(sessionsDir, layout, "project-a"),
            path.join(sessionsDir, "projects-root", "project-a"),
        );
        assert.equal(legacyProjectsStorageRoot(sessionsDir), path.join("/data/.CRAgent", "Projects"));
    });
});
