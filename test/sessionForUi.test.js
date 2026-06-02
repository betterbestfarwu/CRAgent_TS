import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMetaFromFile } from "../src/main/sessionMeta.js";
import { ipcPayloadForRenderer } from "../src/main/rendererSession.js";
import { stripMessageImagesForUi, stripSessionImagesForUi } from "../src/shared/sessionForUi.js";
import { IPC_CHANNELS } from "../src/shared/ipc.js";

describe("stripSessionImagesForUi", () => {
    it("removes dataUrl from message images", () => {
        const session = {
            meta: { id: "s1" },
            messages: [
                {
                    id: "m1",
                    role: "user",
                    content: "hello",
                    images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA" }],
                },
            ],
        };

        const stripped = stripSessionImagesForUi(session);
        assert.equal(stripped.messages[0].images[0].mimeType, "image/png");
        assert.equal(stripped.messages[0].images[0].hasData, true);
        assert.equal(stripped.messages[0].images[0].dataUrl, undefined);
        assert.equal(session.messages[0].images[0].dataUrl, "data:image/png;base64,AAAA");
    });

    it("returns the same object when no images are present", () => {
        const session = {
            meta: { id: "s1" },
            messages: [{ id: "m1", role: "user", content: "hello" }],
        };
        assert.equal(stripSessionImagesForUi(session), session);
    });
});

describe("stripMessageImagesForUi", () => {
    it("removes dataUrl from a single message", () => {
        const message = {
            id: "m1",
            role: "user",
            content: "pic",
            images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,BBBB" }],
        };
        const stripped = stripMessageImagesForUi(message);
        assert.equal(stripped.images[0].hasData, true);
        assert.equal(stripped.images[0].dataUrl, undefined);
    });
});

describe("ipcPayloadForRenderer", () => {
    it("strips session payloads before IPC", () => {
        const payload = {
            meta: { id: "s1" },
            messages: [
                {
                    id: "m1",
                    role: "user",
                    images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,CCCC" }],
                },
            ],
        };
        const stripped = ipcPayloadForRenderer(IPC_CHANNELS.onSessionChanged, payload);
        assert.equal(stripped.messages[0].images[0].dataUrl, undefined);
    });

    it("strips appended message payloads before IPC", () => {
        const payload = {
            sessionId: "s1",
            message: {
                id: "m1",
                role: "user",
                images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,DDDD" }],
            },
        };
        const stripped = ipcPayloadForRenderer(IPC_CHANNELS.onMessageAppended, payload);
        assert.equal(stripped.message.images[0].dataUrl, undefined);
    });
});

describe("readSessionMetaFromFile", () => {
    it("reads meta without parsing messages", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-meta-"));
        const filePath = path.join(dir, "session.json");
        const hugePayload = "x".repeat(50_000);
        fs.writeFileSync(
            filePath,
            JSON.stringify(
                {
                    meta: {
                        id: "abc",
                        title: "Test \"brace\" {ok}",
                        nested: { value: 1 },
                    },
                    messages: [{ id: "m1", role: "user", content: hugePayload }],
                },
                null,
                2,
            ),
            "utf-8",
        );

        const meta = readSessionMetaFromFile(filePath);
        assert.equal(meta.id, "abc");
        assert.equal(meta.title, 'Test "brace" {ok}');
        assert.deepEqual(meta.nested, { value: 1 });
    });
});
