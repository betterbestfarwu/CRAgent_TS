import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildComposerRetryState,
    parseAttachedFilesFromContent,
} from "@shared/composerRetry.js";

describe("parseAttachedFilesFromContent", () => {
    it("extracts attached files and leading text", () => {
        const content =
            "review this\n\n已附加文件：\n- /tmp/a.txt\n- /tmp/b/c.md\n\n请先阅读这些文件，再继续处理当前任务。";
        const parsed = parseAttachedFilesFromContent(content);
        assert.equal(parsed.text, "review this");
        assert.deepEqual(parsed.files, [
            { path: "/tmp/a.txt", name: "a.txt" },
            { path: "/tmp/b/c.md", name: "c.md" },
        ]);
    });

    it("handles files-only content", () => {
        const content = "已附加文件：\n- /tmp/a.txt\n\n请先阅读这些文件，再继续处理当前任务。";
        const parsed = parseAttachedFilesFromContent(content);
        assert.equal(parsed.text, "");
        assert.equal(parsed.files.length, 1);
    });
});

describe("buildComposerRetryState", () => {
    it("restores user text, mentions, files, and images", () => {
        const state = buildComposerRetryState({
            role: "user",
            content:
                "@src/foo.ts\n\n已附加文件：\n- /tmp/a.txt\n\n请先阅读这些文件，再继续处理当前任务。",
            userText: "check this",
            atMentions: [{ name: "foo.ts", relativePath: "src/foo.ts" }],
            images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,abc" }],
        });

        assert.equal(state.text, "check this");
        assert.equal(state.mentions.length, 1);
        assert.equal(state.mentions[0].relativePath, "src/foo.ts");
        assert.equal(state.files.length, 1);
        assert.equal(state.files[0].path, "/tmp/a.txt");
        assert.equal(state.images.length, 1);
        assert.equal(state.images[0].mimeType, "image/png");
    });

    it("falls back to content without file block when userText is absent", () => {
        const state = buildComposerRetryState({
            role: "user",
            content: "hello world",
        });
        assert.equal(state.text, "hello world");
        assert.equal(state.files.length, 0);
    });
});
