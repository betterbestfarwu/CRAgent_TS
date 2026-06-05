import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolvePathInWorkspace } from "../src/main/workspacePaths.js";

describe("resolvePathInWorkspace", () => {
    it("accepts relative paths under the workspace root", () => {
        const workspace = os.tmpdir();
        const resolved = resolvePathInWorkspace(workspace, "nested/file.txt");
        assert.equal(resolved, path.resolve(workspace, "nested/file.txt"));
    });

    it("accepts macOS /var and /private/var aliases for the same directory", () => {
        const workspace = "/var/tmp";
        const resolved = resolvePathInWorkspace(workspace, "/private/var/tmp/nested.txt");
        assert.equal(resolved, path.resolve("/private/var/tmp/nested.txt"));
    });

    it("rejects paths outside the workspace", () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-ws-"));
        assert.throws(
            () => resolvePathInWorkspace(workspace, "/etc/passwd"),
            /path must stay inside workspace/,
        );
    });

    it("allows new files under the workspace before they exist", () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-ws-"));
        const resolved = resolvePathInWorkspace(workspace, "new-dir/new-file.txt");
        assert.equal(resolved, path.join(workspace, "new-dir/new-file.txt"));
    });
});
