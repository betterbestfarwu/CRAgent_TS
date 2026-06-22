import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    appendSpaceAfterInsertAt,
    buildAtNavItems,
    buildComposerDisplaySegments,
    buildComposerSegments,
    buildPathTreeSegments,
    filterDirectoryEntries,
    formatAtMentionsForDisplay,
    buildInputWithAtMentions,
    isActiveManualAtMention,
    isAtSignKey,
    parentRelativePath,
    parseActiveAtMention,
    splitAtQueryPath,
} from "@shared/atMention.js";
import { expandAtMentionsToAbsolute } from "../src/main/atMentionExpand.js";
import {
    COMPOSER_CARET_ZWSP,
    normalizeComposerEditorText,
    shouldComposerBackspaceRemoveChip,
} from "@shared/composerEditor.js";

describe("parseActiveAtMention", () => {
    it("detects trailing @ mention", () => {
        const parsed = parseActiveAtMention("hello @src/re");
        assert.equal(parsed?.query, "src/re");
        assert.equal(parsed?.mentionStart, 6);
        assert.equal(parsed?.mentionEnd, 13);
    });

    it("detects @ mention at caret when text continues after it", () => {
        const parsed = parseActiveAtMention("@file hello", 5);
        assert.equal(parsed?.query, "file");
        assert.equal(parsed?.mentionStart, 0);
        assert.equal(parsed?.mentionEnd, 5);
    });

    it("returns null when caret is past an inactive @ mention", () => {
        assert.equal(parseActiveAtMention("@file hello"), null);
        assert.equal(parseActiveAtMention("@file hello", 13), null);
    });

    it("returns null for emails and URL userinfo", () => {
        assert.equal(parseActiveAtMention("user@example.com"), null);
        assert.equal(parseActiveAtMention("mailto:user@example.com"), null);
        assert.equal(
            parseActiveAtMention("https://user:pass@googleapis.com/foo"),
            null,
        );
    });

    it("detects @ mention directly after text without whitespace", () => {
        const parsed = parseActiveAtMention("hello@src/re");
        assert.equal(parsed?.query, "src/re");
        assert.equal(parsed?.mentionStart, 5);
        assert.equal(parsed?.mentionEnd, 12);
    });

    it("detects @ immediately after text", () => {
        assert.deepEqual(parseActiveAtMention("hello@", 6), {
            query: "",
            mentionStart: 5,
            mentionEnd: 6,
        });
    });

    it("returns null for @ embedded in Chinese prose", () => {
        assert.equal(parseActiveAtMention("文字@的"), null);
        assert.equal(parseActiveAtMention("文字@的", 4), null);
    });

    it("detects manually typed @ after Chinese text", () => {
        assert.deepEqual(parseActiveAtMention("文字@", 3), {
            query: "",
            mentionStart: 2,
            mentionEnd: 3,
        });
    });

    it("allows @ file mention after whitespace with Chinese query", () => {
        const parsed = parseActiveAtMention("请查看 @文档");
        assert.equal(parsed?.query, "文档");
        assert.equal(parsed?.mentionStart, 4);
    });
});

describe("manual at mention gating", () => {
    it("detects @ key presses", () => {
        assert.equal(isAtSignKey({ key: "@" }), true);
        assert.equal(isAtSignKey({ key: "2", shiftKey: true }), true);
        assert.equal(isAtSignKey({ key: "a" }), false);
        assert.equal(isAtSignKey({ key: "@", ctrlKey: true }), false);
    });

    it("only opens menu for manually typed @ positions", () => {
        const mention = parseActiveAtMention("文字@的");
        assert.equal(mention, null);
        assert.equal(isActiveManualAtMention(mention, 2), false);

        const manual = parseActiveAtMention("hello@", 6);
        assert.equal(isActiveManualAtMention(manual, 5), true);
        assert.equal(isActiveManualAtMention(manual, null), false);
        assert.equal(isActiveManualAtMention(manual, 4), false);
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

describe("appendSpaceAfterInsertAt", () => {
    it("adds a space after the mention position", () => {
        assert.equal(appendSpaceAfterInsertAt("", 0), " ");
        assert.equal(appendSpaceAfterInsertAt("hello ", 6), "hello  ");
    });

    it("does not duplicate an existing space", () => {
        assert.equal(appendSpaceAfterInsertAt(" ", 0), " ");
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

    it("requires every provided filter to match the entry name", () => {
        const entries = [
            { name: "ComposerAtMenu.jsx", kind: "file", relativePath: "ComposerAtMenu.jsx" },
            { name: "ComposerSlashMenu.jsx", kind: "file", relativePath: "ComposerSlashMenu.jsx" },
            { name: "Sidebar.jsx", kind: "file", relativePath: "Sidebar.jsx" },
        ];

        const filtered = filterDirectoryEntries(entries, "composer", "at");

        assert.deepEqual(filtered.map((entry) => entry.name), ["ComposerAtMenu.jsx"]);
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
    it("appends @ relative paths after user text when insertAt is omitted", () => {
        assert.equal(
            buildInputWithAtMentions("fix styles", [
                { name: "styles.css", relativePath: "src/renderer/styles.css" },
            ]),
            "fix styles @src/renderer/styles.css",
        );
    });

    it("inserts @ relative paths at the recorded position", () => {
        assert.equal(
            buildInputWithAtMentions("cat", [
                { name: "README.md", relativePath: "README.md", insertAt: 3 },
            ]),
            "cat @README.md",
        );
        assert.equal(
            buildInputWithAtMentions("hello world", [
                { name: "App.jsx", relativePath: "src/App.jsx", insertAt: 6 },
            ]),
            "hello @src/App.jsx world",
        );
    });

    it("returns mention-only input when text is empty", () => {
        assert.equal(
            buildInputWithAtMentions("", [{ name: "App.jsx", relativePath: "src/App.jsx" }]),
            "@src/App.jsx",
        );
    });
});

describe("normalizeComposerEditorText", () => {
    it("strips invisible caret anchors", () => {
        assert.equal(normalizeComposerEditorText(`hello${COMPOSER_CARET_ZWSP}`), "hello");
    });
});

describe("buildComposerSegments", () => {
    it("places trailing mentions after typed text", () => {
        assert.deepEqual(
            buildComposerSegments("cat", [{ id: "m1", insertAt: 3 }]),
            [
                { kind: "text", content: "cat" },
                { kind: "mention", mentionId: "m1" },
                { kind: "text", content: "" },
            ],
        );
    });

    it("places leading mentions before typed text", () => {
        assert.deepEqual(
            buildComposerSegments(" cat", [{ id: "m1", insertAt: 0 }]),
            [
                { kind: "mention", mentionId: "m1" },
                { kind: "text", content: " cat" },
            ],
        );
    });

    it("splits text around middle mentions", () => {
        assert.deepEqual(
            buildComposerSegments("hello world", [{ id: "m1", insertAt: 6 }]),
            [
                { kind: "text", content: "hello " },
                { kind: "mention", mentionId: "m1" },
                { kind: "text", content: "world" },
            ],
        );
    });
});

describe("buildComposerDisplaySegments", () => {
    it("places dragged files after @ mentions when insertAt is later", () => {
        assert.deepEqual(
            buildComposerDisplaySegments(" ", [{ id: "m1", insertAt: 0 }], [{ id: "f1", insertAt: 1 }]),
            [
                { kind: "mention", mentionId: "m1" },
                { kind: "text", content: " " },
                { kind: "file", fileId: "f1" },
                { kind: "text", content: "" },
            ],
        );
    });

    it("keeps drag-first ordering when mention and file share insertAt 0", () => {
        assert.deepEqual(
            buildComposerDisplaySegments(
                " ",
                [{ id: "m1", insertAt: 0, attachSeq: 2 }],
                [{ id: "f1", insertAt: 0, attachSeq: 1 }],
            ),
            [
                { kind: "file", fileId: "f1" },
                { kind: "mention", mentionId: "m1" },
                { kind: "text", content: " " },
            ],
        );
    });
});

describe("shouldComposerBackspaceRemoveChip", () => {
    it("removes chip when text node is zwsp-only filler", () => {
        assert.equal(shouldComposerBackspaceRemoveChip("", ""), true);
        assert.equal(
            shouldComposerBackspaceRemoveChip("", normalizeComposerEditorText(COMPOSER_CARET_ZWSP)),
            true,
        );
    });

    it("removes chip when text node is whitespace-only filler after mention", () => {
        assert.equal(shouldComposerBackspaceRemoveChip(" ", " "), true);
        assert.equal(
            shouldComposerBackspaceRemoveChip(
                " ",
                normalizeComposerEditorText(` ${COMPOSER_CARET_ZWSP}`),
            ),
            true,
        );
    });

    it("does not remove chip when user typed visible text after mention", () => {
        assert.equal(shouldComposerBackspaceRemoveChip(" hello", " hello"), false);
        assert.equal(shouldComposerBackspaceRemoveChip("hello", "hello"), false);
    });

    it("removes chip when caret is between chip filler and later visible text", () => {
        assert.equal(shouldComposerBackspaceRemoveChip("", "hello"), true);
        assert.equal(shouldComposerBackspaceRemoveChip(" ", " hello"), true);
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
