import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { listProjectDirectory } from "../src/main/projectBrowse.js";

describe("listProjectDirectory", () => {
    it("searches matching files and folders recursively from the requested directory", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-project-browse-"));
        fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
        fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
        fs.mkdirSync(path.join(root, "src", "node_modules", "ignored-search"), { recursive: true });
        fs.writeFileSync(path.join(root, "src", "SearchRoot.js"), "");
        fs.writeFileSync(path.join(root, "src", "components", "SearchBox.jsx"), "");
        fs.writeFileSync(path.join(root, "src", "pages", "Home.jsx"), "");
        fs.writeFileSync(path.join(root, "src", "node_modules", "ignored-search", "SearchLib.js"), "");

        const result = await listProjectDirectory(root, "src", "search");

        assert.equal(result.relativePath, "src");
        assert.deepEqual(
            result.entries.map((entry) => entry.relativePath).sort(),
            ["src/SearchRoot.js", "src/components/SearchBox.jsx"],
        );
    });
});
