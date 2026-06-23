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
    normalizeAtMentions,
    parentRelativePath,
    parseActiveAtMention,
    splitAtQueryPath,
} from "@shared/atMention.js";
import { expandAtMentionsToAbsolute } from "../src/main/atMentionExpand.js";
import {
    COMPOSER_CARET_ZWSP,
    collectComposerAddedChips,
    getComposerChipAfterSelection,
    getComposerChipBeforeSelection,
    moveComposerCaretBeforeChipBeforeSelection,
    moveComposerCaretLeftBeforeChipIfNeeded,
    normalizeComposerEditorText,
    placeComposerCaretAfterChip,
    shouldComposerArrowLeftJumpBeforeChip,
    shouldComposerBackspaceRemoveChip,
    syncComposerEditorRefsAfterInternalEdit,
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

describe("normalizeAtMentions", () => {
    it("preserves insertAt so history bubbles can match composer order", () => {
        assert.deepEqual(
            normalizeAtMentions([
                { name: "AirStreamClient.cs", relativePath: "AirStreamClient.cs", insertAt: 5 },
                { name: "RTCStatistics.cs", relativePath: "RTCStatistics.cs", insertAt: 9 },
            ]),
            [
                { name: "AirStreamClient.cs", relativePath: "AirStreamClient.cs", insertAt: 5 },
                { name: "RTCStatistics.cs", relativePath: "RTCStatistics.cs", insertAt: 9 },
            ],
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

describe("shouldComposerArrowLeftJumpBeforeChip", () => {
    function withFakeDom(testBody) {
        const originalNode = globalThis.Node;
        try {
            globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
            testBody();
        } finally {
            globalThis.Node = originalNode;
        }
    }

    it("jumps before chip at the start of trailing text", () => {
        withFakeDom(() => {
            assert.equal(shouldComposerArrowLeftJumpBeforeChip({ nodeType: 3, nodeValue: " hello" }, 0), true);
        });
    });

    it("does not jump when visible text remains to the left inside the node", () => {
        withFakeDom(() => {
            assert.equal(shouldComposerArrowLeftJumpBeforeChip({ nodeType: 3, nodeValue: " hello" }, 1), false);
            assert.equal(shouldComposerArrowLeftJumpBeforeChip({ nodeType: 3, nodeValue: "hello" }, 3), false);
        });
    });

    it("jumps from zwsp-only caret anchor after chip", () => {
        withFakeDom(() => {
            assert.equal(
                shouldComposerArrowLeftJumpBeforeChip({ nodeType: 3, nodeValue: COMPOSER_CARET_ZWSP }, 1),
                true,
            );
        });
    });
});

describe("moveComposerCaretBeforeChipBeforeSelection", () => {
    function withFakeDom(testBody) {
        const originalNode = globalThis.Node;
        const originalWindow = globalThis.window;
        const originalDocument = globalThis.document;
        try {
            globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
            testBody();
        } finally {
            globalThis.Node = originalNode;
            globalThis.window = originalWindow;
            globalThis.document = originalDocument;
        }
    }

    function createFakeChip(id) {
        return {
            nodeType: 1,
            classList: { contains: (name) => name === "composer-at-chip" },
            dataset: { mentionId: id },
        };
    }

    function installFakeSelection(range) {
        const selection = {
            rangeCount: 1,
            range,
            removed: false,
            addedRange: null,
            getRangeAt() {
                return this.range;
            },
            removeAllRanges() {
                this.removed = true;
            },
            addRange(nextRange) {
                this.addedRange = nextRange;
            },
        };
        globalThis.window = { getSelection: () => selection };
        globalThis.document = {
            createRange: () => ({
                before: null,
                startNode: null,
                startOffset: null,
                collapsed: false,
                setStart(node, offset) {
                    this.startNode = node;
                    this.startOffset = offset;
                },
                setStartBefore(node) {
                    this.before = node;
                },
                collapse(value) {
                    this.collapsed = value;
                },
            }),
            createTextNode: (value) => ({
                nodeType: 3,
                nodeValue: value,
                textContent: value,
            }),
        };
        return selection;
    }

    it("places the contenteditable selection before the chip behind the caret", () => {
        withFakeDom(() => {
            const chip = createFakeChip("m1");
            const anchor = {
                nodeType: 3,
                nodeValue: COMPOSER_CARET_ZWSP,
                textContent: COMPOSER_CARET_ZWSP,
                previousSibling: chip,
            };
            const root = {
                childNodes: [chip, anchor],
                contains: (node) => node === chip || node === anchor,
                focusCalled: false,
                focus() {
                    this.focusCalled = true;
                },
            };
            const selection = installFakeSelection({
                collapsed: true,
                startContainer: anchor,
                startOffset: 1,
            });

            assert.equal(moveComposerCaretBeforeChipBeforeSelection(root), true);
            assert.equal(selection.removed, true);
            assert.equal(selection.addedRange.before, chip);
            assert.equal(selection.addedRange.collapsed, true);
            assert.equal(root.focusCalled, true);
        });
    });

    it("steps backward across adjacent chips instead of deleting them", () => {
        withFakeDom(() => {
            const first = createFakeChip("m1");
            const second = createFakeChip("m2");
            const root = {
                childNodes: [first, second],
                contains: (node) => node === root || node === first || node === second,
                focus() {},
            };
            const selection = installFakeSelection({
                collapsed: true,
                startContainer: root,
                startOffset: 2,
            });

            assert.equal(moveComposerCaretBeforeChipBeforeSelection(root), true);
            assert.equal(selection.addedRange.before, second);

            selection.range = {
                collapsed: true,
                startContainer: root,
                startOffset: 1,
            };
            assert.equal(moveComposerCaretBeforeChipBeforeSelection(root), true);
            assert.equal(selection.addedRange.before, first);
        });
    });
});

describe("getComposerChipBeforeSelection", () => {
    function withFakeDom(testBody) {
        const originalNode = globalThis.Node;
        const originalWindow = globalThis.window;
        try {
            globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
            testBody();
        } finally {
            globalThis.Node = originalNode;
            globalThis.window = originalWindow;
        }
    }

    function createFakeChip(id, kind = "mention") {
        return {
            nodeType: 1,
            classList: { contains: (name) => name === "composer-at-chip" },
            dataset: kind === "file" ? { fileId: id } : { mentionId: id },
        };
    }

    it("detects mention chip immediately before the caret", () => {
        withFakeDom(() => {
            const chip = createFakeChip("m1");
            const anchor = {
                nodeType: 3,
                nodeValue: COMPOSER_CARET_ZWSP,
                textContent: COMPOSER_CARET_ZWSP,
                previousSibling: chip,
            };
            const root = {
                childNodes: [chip, anchor],
                contains: (node) => node === root || node === chip || node === anchor,
            };
            globalThis.window = {
                getSelection: () => ({
                    rangeCount: 1,
                    getRangeAt: () => ({
                        collapsed: true,
                        startContainer: anchor,
                        startOffset: 1,
                    }),
                }),
            };

            assert.deepEqual(getComposerChipBeforeSelection(root), { mentionId: "m1" });
        });
    });

    it("detects file chip immediately before the caret", () => {
        withFakeDom(() => {
            const chip = createFakeChip("f1", "file");
            const anchor = {
                nodeType: 3,
                nodeValue: COMPOSER_CARET_ZWSP,
                textContent: COMPOSER_CARET_ZWSP,
                previousSibling: chip,
            };
            const root = {
                childNodes: [chip, anchor],
                contains: (node) => node === root || node === chip || node === anchor,
            };
            globalThis.window = {
                getSelection: () => ({
                    rangeCount: 1,
                    getRangeAt: () => ({
                        collapsed: true,
                        startContainer: anchor,
                        startOffset: 1,
                    }),
                }),
            };

            assert.deepEqual(getComposerChipBeforeSelection(root), { fileId: "f1" });
        });
    });
});

describe("moveComposerCaretLeftBeforeChipIfNeeded", () => {
    function withFakeDom(testBody) {
        const originalNode = globalThis.Node;
        const originalWindow = globalThis.window;
        const originalDocument = globalThis.document;
        try {
            globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
            testBody();
        } finally {
            globalThis.Node = originalNode;
            globalThis.window = originalWindow;
            globalThis.document = originalDocument;
        }
    }

    function createFakeChip(id) {
        return {
            nodeType: 1,
            classList: { contains: (name) => name === "composer-at-chip" },
            dataset: { mentionId: id },
        };
    }

    function installFakeSelection(range) {
        const selection = {
            rangeCount: 1,
            range,
            removed: false,
            addedRange: null,
            getRangeAt() {
                return this.range;
            },
            removeAllRanges() {
                this.removed = true;
            },
            addRange(nextRange) {
                this.addedRange = nextRange;
            },
        };
        globalThis.window = { getSelection: () => selection };
        globalThis.document = {
            createRange: () => ({
                before: null,
                startNode: null,
                startOffset: null,
                collapsed: false,
                setStart(node, offset) {
                    this.startNode = node;
                    this.startOffset = offset;
                },
                setStartBefore(node) {
                    this.before = node;
                },
                collapse(value) {
                    this.collapsed = value;
                },
            }),
            createTextNode: (value) => ({
                nodeType: 3,
                nodeValue: value,
                textContent: value,
            }),
        };
        return selection;
    }

    it("places the selection before the chip behind the caret", () => {
        withFakeDom(() => {
            const leading = {
                nodeType: 3,
                nodeValue: "x",
                textContent: "x",
            };
            const chip = createFakeChip("m1");
            const anchor = {
                nodeType: 3,
                nodeValue: COMPOSER_CARET_ZWSP,
                textContent: COMPOSER_CARET_ZWSP,
                previousSibling: chip,
            };
            chip.previousSibling = leading;
            const root = {
                nodeType: 1,
                childNodes: [leading, chip, anchor],
                contains: (node) => node === root || node === leading || node === chip || node === anchor,
                focus() {},
            };
            const selection = installFakeSelection({
                collapsed: true,
                startContainer: anchor,
                startOffset: 1,
            });

            assert.equal(moveComposerCaretLeftBeforeChipIfNeeded(root), true);
            assert.equal(selection.addedRange.before, chip);
        });
    });

    it("places the selection in a leading caret anchor before a leading chip", () => {
        withFakeDom(() => {
            const chip = createFakeChip("m1");
            const anchor = {
                nodeType: 3,
                nodeValue: COMPOSER_CARET_ZWSP,
                textContent: COMPOSER_CARET_ZWSP,
                previousSibling: chip,
            };
            const root = {
                nodeType: 1,
                childNodes: [chip, anchor],
                contains: (node) => node === root || node === chip || node === anchor,
                insertBefore(node, before) {
                    const index = this.childNodes.indexOf(before);
                    if (index === -1) {
                        this.childNodes.push(node);
                    } else {
                        this.childNodes.splice(index, 0, node);
                    }
                    node.parentNode = this;
                    node.nextSibling = before;
                    before.previousSibling = node;
                    return node;
                },
                focus() {},
            };
            installFakeSelection({
                collapsed: true,
                startContainer: anchor,
                startOffset: 1,
            });

            assert.equal(moveComposerCaretLeftBeforeChipIfNeeded(root), true);
            assert.equal(root.childNodes[0].nodeValue, COMPOSER_CARET_ZWSP);
        });
    });

    it("does not skip visible text when moving left inside trailing text", () => {
        withFakeDom(() => {
            const chip = createFakeChip("m1");
            const trailing = {
                nodeType: 3,
                nodeValue: " hello",
                textContent: " hello",
                previousSibling: chip,
            };
            const root = {
                nodeType: 1,
                childNodes: [chip, trailing],
                contains: (node) => node === root || node === chip || node === trailing,
                focus() {},
            };
            installFakeSelection({
                collapsed: true,
                startContainer: trailing,
                startOffset: 1,
            });

            assert.equal(moveComposerCaretLeftBeforeChipIfNeeded(root), false);
        });
    });
});

describe("placeComposerCaretAfterChip", () => {
    function withFakeDom(testBody) {
        const originalNode = globalThis.Node;
        const originalWindow = globalThis.window;
        const originalDocument = globalThis.document;
        try {
            globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
            testBody();
        } finally {
            globalThis.Node = originalNode;
            globalThis.window = originalWindow;
            globalThis.document = originalDocument;
        }
    }

    function createFakeChip(id, kind = "mention") {
        return {
            nodeType: 1,
            classList: { contains: (name) => name === "composer-at-chip" },
            dataset: kind === "file" ? { fileId: id } : { mentionId: id },
            childNodes: [],
        };
    }

    function installFakeSelection() {
        const selection = {
            removed: false,
            addedRange: null,
            removeAllRanges() {
                this.removed = true;
            },
            addRange(nextRange) {
                this.addedRange = nextRange;
            },
        };
        globalThis.window = { getSelection: () => selection };
        globalThis.document = {
            createRange: () => ({
                startNode: null,
                startOffset: null,
                after: null,
                collapsed: false,
                setStart(node, offset) {
                    this.startNode = node;
                    this.startOffset = offset;
                },
                setStartAfter(node) {
                    this.after = node;
                },
                collapse(value) {
                    this.collapsed = value;
                },
            }),
        };
        return selection;
    }

    it("places caret at the start of visible text after a mention chip", () => {
        withFakeDom(() => {
            const chip = createFakeChip("m1");
            const trailing = {
                nodeType: 3,
                nodeValue: " world",
                textContent: " world",
                childNodes: [],
            };
            chip.nextSibling = trailing;
            const root = {
                nodeType: 1,
                childNodes: [chip, trailing],
                contains: (node) => node === root || node === chip || node === trailing,
            };
            const selection = installFakeSelection();

            assert.equal(placeComposerCaretAfterChip(root, { mentionId: "m1" }), true);
            assert.equal(selection.removed, true);
            assert.equal(selection.addedRange.startNode, trailing);
            assert.equal(selection.addedRange.startOffset, 0);
            assert.equal(selection.addedRange.collapsed, true);
        });
    });

    it("places caret at the end of the invisible anchor after a trailing file chip", () => {
        withFakeDom(() => {
            const chip = createFakeChip("f1", "file");
            const anchor = {
                nodeType: 3,
                nodeValue: COMPOSER_CARET_ZWSP,
                textContent: COMPOSER_CARET_ZWSP,
                childNodes: [],
            };
            chip.nextSibling = anchor;
            const root = {
                nodeType: 1,
                childNodes: [chip, anchor],
                contains: (node) => node === root || node === chip || node === anchor,
            };
            const selection = installFakeSelection();

            assert.equal(placeComposerCaretAfterChip(root, { fileId: "f1" }), true);
            assert.equal(selection.addedRange.startNode, anchor);
            assert.equal(selection.addedRange.startOffset, 1);
            assert.equal(selection.addedRange.collapsed, true);
        });
    });
});

describe("collectComposerAddedChips", () => {
    it("treats existing chips as added on the first contenteditable mount", () => {
        assert.deepEqual(
            collectComposerAddedChips({
                mentions: [{ id: "m1", attachSeq: 1 }],
                files: [{ id: "f1", attachSeq: 2 }],
                previousMentionIds: new Set(),
                previousFileIds: new Set(),
            }),
            [
                { mentionId: "m1", attachSeq: 1 },
                { fileId: "f1", attachSeq: 2 },
            ],
        );
    });

    it("only returns chips that were not previously synced", () => {
        assert.deepEqual(
            collectComposerAddedChips({
                mentions: [{ id: "m1", attachSeq: 1 }, { id: "m2", attachSeq: 3 }],
                files: [{ id: "f1", attachSeq: 2 }],
                previousMentionIds: new Set(["m1"]),
                previousFileIds: new Set(["f1"]),
            }),
            [{ mentionId: "m2", attachSeq: 3 }],
        );
    });
});

describe("syncComposerEditorRefsAfterInternalEdit", () => {
    it("marks text and chip structure as synced after typing before a mention", () => {
        const refs = {
            internalEditRef: { current: true },
            lastSyncedInputRef: { current: "aa" },
            lastMentionSignatureRef: { current: "m1:1" },
            lastFilesSignatureRef: { current: "" },
            lastProjectDirectoryPathRef: { current: "/project" },
            prevMentionCountRef: { current: 1 },
            prevFileCountRef: { current: 0 },
            prevMentionIdsRef: { current: new Set(["m1"]) },
            prevFileIdsRef: { current: new Set() },
        };

        syncComposerEditorRefsAfterInternalEdit(refs, {
            input: "axa",
            mentionSignature: "m1:2",
            filesSignature: "",
            projectDirectoryPath: "/project",
            mentions: [{ id: "m1", insertAt: 2 }],
            files: [],
        });

        assert.equal(refs.internalEditRef.current, false);
        assert.equal(refs.lastSyncedInputRef.current, "axa");
        assert.equal(refs.lastMentionSignatureRef.current, "m1:2");
        assert.equal(refs.lastFilesSignatureRef.current, "");
        assert.equal(refs.lastProjectDirectoryPathRef.current, "/project");
        assert.equal(refs.prevMentionCountRef.current, 1);
        assert.equal(refs.prevFileCountRef.current, 0);
        assert.deepEqual([...refs.prevMentionIdsRef.current], ["m1"]);
        assert.deepEqual([...refs.prevFileIdsRef.current], []);
    });
});

describe("getComposerChipAfterSelection", () => {
    function withFakeDom(testBody) {
        const originalNode = globalThis.Node;
        const originalWindow = globalThis.window;
        try {
            globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
            testBody();
        } finally {
            globalThis.Node = originalNode;
            globalThis.window = originalWindow;
        }
    }

    function createFakeChip(id, kind = "mention") {
        return {
            nodeType: 1,
            classList: { contains: (name) => name === "composer-at-chip" },
            dataset: kind === "file" ? { fileId: id } : { mentionId: id },
        };
    }

    it("detects chip immediately after a collapsed root selection", () => {
        withFakeDom(() => {
            const chip = createFakeChip("m1");
            const root = {
                nodeType: 1,
                childNodes: [chip],
                contains: (node) => node === root || node === chip,
            };
            globalThis.window = {
                getSelection: () => ({
                    rangeCount: 1,
                    getRangeAt: () => ({
                        collapsed: true,
                        startContainer: root,
                        startOffset: 0,
                    }),
                }),
            };

            assert.deepEqual(getComposerChipAfterSelection(root), { mentionId: "m1" });
        });
    });

    it("detects file chip after caret positioned before it", () => {
        withFakeDom(() => {
            const chip = createFakeChip("f1", "file");
            const root = {
                nodeType: 1,
                childNodes: [chip],
                contains: (node) => node === root || node === chip,
            };
            globalThis.window = {
                getSelection: () => ({
                    rangeCount: 1,
                    getRangeAt: () => ({
                        collapsed: true,
                        startContainer: root,
                        startOffset: 0,
                    }),
                }),
            };

            assert.deepEqual(getComposerChipAfterSelection(root), { fileId: "f1" });
        });
    });

    it("returns null when caret is inside trailing text after chip", () => {
        withFakeDom(() => {
            const chip = createFakeChip("m1");
            const anchor = {
                nodeType: 3,
                nodeValue: COMPOSER_CARET_ZWSP,
                textContent: COMPOSER_CARET_ZWSP,
                previousSibling: chip,
                nextSibling: null,
            };
            const root = {
                childNodes: [chip, anchor],
                contains: (node) => node === chip || node === anchor,
            };
            globalThis.window = {
                getSelection: () => ({
                    rangeCount: 1,
                    getRangeAt: () => ({
                        collapsed: true,
                        startContainer: anchor,
                        startOffset: 0,
                    }),
                }),
            };

            assert.equal(getComposerChipAfterSelection(root), null);
        });
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
