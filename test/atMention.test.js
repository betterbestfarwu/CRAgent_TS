import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildAtNavItems,
    buildPathTreeSegments,
    filterDirectoryEntries,
    formatAtMentionsForDisplay,
    buildInputWithAtMentions,
    parentRelativePath,
    parseActiveAtMention,
    splitAtQueryPath,
} from "@shared/atMention.js";
import { expandAtMentionsToAbsolute } from "../src/main/atMentionExpand.js";

describe("parseActiveAtMention", () => {
    it("detects trailing @ mention", () => {
        const parsed = parseActiveAtMention("hello @src/re");
        assert.equal(parsed?.query, "src/re");
        assert.equal(parsed?.mentionStart, 6);
        assert.equal(parsed?.mentionEnd, 13);
    });

    it("returns null when @ is not active at end", () => {
        assert.equal(parseActiveAtMention("@file hello"), null);
    });
});

describe("splitAtQueryPath", () => {
    it("splits directory prefix and filter", () => {
        assert.deepEqual(splitAtQueryPath("src/renderer/App"), {
            relativePath: "src/renderer",
            filter: "App",
        });
    });
});

describe("buildAtNavItems", () => {
    it("includes parent row when inside subdirectory", () => {
        const items = buildAtNavItems(
            [{ name: "App.jsx", kind: "file", relativePath: "src/App.jsx" }],
            "src",
            true,
        );
        assert.equal(items[0].kind, "parent");
        assert.equal(items[1].kind, "entry");
    });
});

describe("filterDirectoryEntries", () => {
    it("filters by name substring", () => {
        const entries = [
            { name: "App.jsx", kind: "file", relativePath: "App.jsx" },
            { name: "main.js", kind: "file", relativePath: "main.js" },
        ];
        const filtered = filterDirectoryEntries(entries, "app");
        assert.equal(filtered.length, 1);
        assert.equal(filtered[0].name, "App.jsx");
    });
});

describe("parentRelativePath", () => {
    it("returns parent directory", () => {
        assert.equal(parentRelativePath("src/renderer"), "src");
        assert.equal(parentRelativePath("src"), "");
    });
});

describe("buildPathTreeSegments", () => {
    it("builds breadcrumb segments", () => {
        assert.deepEqual(buildPathTreeSegments("src/renderer", "styles.css"), [
            "src",
            "renderer",
            "styles.css",
        ]);
    });
});

describe("formatAtMentionsForDisplay", () => {
    it("collapses absolute and relative @ paths to filename", () => {
        assert.equal(
            formatAtMentionsForDisplay(
                "请分析 @/Users/me/project/src/App.jsx 和 @README.md",
            ),
            "请分析 @App.jsx 和 @README.md",
        );
        assert.equal(
            formatAtMentionsForDisplay("read @src/renderer/App.jsx please"),
            "read @App.jsx please",
        );
    });

    it("leaves text without @ mentions unchanged", () => {
        const text = "hello world";
        assert.equal(formatAtMentionsForDisplay(text), text);
    });
});

describe("buildInputWithAtMentions", () => {
    it("appends @ relative paths after user text", () => {
        assert.equal(
            buildInputWithAtMentions("fix styles", [
                { name: "styles.css", relativePath: "src/renderer/styles.css" },
            ]),
            "fix styles @src/renderer/styles.css",
        );
    });

    it("returns mention-only input when text is empty", () => {
        assert.equal(
            buildInputWithAtMentions("", [{ name: "App.jsx", relativePath: "src/App.jsx" }]),
            "@src/App.jsx",
        );
    });
});

describe("expandAtMentionsToAbsolute", () => {
    it("expands relative @ paths under project root", () => {
        const expanded = expandAtMentionsToAbsolute(
            "please read @src/App.jsx and @README.md",
            "/Users/me/project",
        );
        assert.match(expanded, /@\/Users\/me\/project\/src\/App\.jsx/);
        assert.match(expanded, /@\/Users\/me\/project\/README\.md/);
    });

    it("leaves absolute @ paths unchanged", () => {
        const absolute = "@/Users/me/project/src/App.jsx";
        assert.equal(
            expandAtMentionsToAbsolute(`read ${absolute}`, "/Users/me/project"),
            `read ${absolute}`,
        );
    });

    it("returns original text when project root is missing", () => {
        const text = "read @src/App.jsx";
        assert.equal(expandAtMentionsToAbsolute(text, null), text);
    });
});
