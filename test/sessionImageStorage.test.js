import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
    externalizeSessionImages,
    hydrateSessionImages,
    readSessionImageFile,
    sessionHasInlineImages,
} from "../src/main/sessionImageStorage.js";
import { SessionStore } from "../src/main/sessionStore.js";
import { messagesFile, metaFile, sessionDir } from "../src/main/sessionStorage.js";

describe("sessionImageStorage", () => {
    it("externalizes inline images to disk and removes dataUrl from session", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-img-"));
        const session = {
            meta: { id: "session-1" },
            messages: [
                {
                    id: "msg-1",
                    role: "user",
                    content: "pic",
                    images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,QUJD" }],
                },
            ],
        };

        const externalized = externalizeSessionImages(session, dir);
        assert.equal(sessionHasInlineImages(externalized), false);
        assert.match(externalized.messages[0].images[0].imageFile || "", /^msg-1-0\.png$/);
        assert.equal(
            fs.existsSync(path.join(sessionDir(dir, "session-1"), "_images", "msg-1-0.png")),
            true,
        );

        const hydrated = hydrateSessionImages(externalized, dir);
        assert.equal(hydrated.messages[0].images[0].dataUrl, "data:image/png;base64,QUJD");
    });

    it("extracts markdown data URL images from message content", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-img-content-"));
        const session = {
            meta: { id: "session-2" },
            messages: [
                {
                    id: "msg-2",
                    role: "assistant",
                    content: "![image](data:image/png;base64,QUJD)",
                },
            ],
        };

        const externalized = externalizeSessionImages(session, dir);
        assert.equal(externalized.messages[0].content, "");
        assert.match(externalized.messages[0].images[0].imageFile || "", /^msg-2-0\.png$/);

        const hydrated = hydrateSessionImages(externalized, dir);
        assert.equal(hydrated.messages[0].images[0].dataUrl, "data:image/png;base64,QUJD");
    });

    it("hydrates images from legacy global _images storage", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-img-legacy-"));
        const legacyDir = path.join(dir, "_images", "session-legacy");
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, "msg-1-0.png"), Buffer.from("ABC"));
        const session = {
            meta: { id: "session-legacy" },
            messages: [
                {
                    id: "msg-1",
                    role: "user",
                    content: "pic",
                    images: [{ mimeType: "image/png", imageFile: "msg-1-0.png" }],
                },
            ],
        };

        const hydrated = hydrateSessionImages(session, dir);
        assert.equal(hydrated.messages[0].images[0].dataUrl, "data:image/png;base64,QUJD");
    });

    it("hydrates images even when a newer session _images directory also exists", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-img-mixed-"));
        const legacyDir = path.join(dir, "_images", "session-mixed");
        const newDir = path.join(sessionDir(dir, "session-mixed"), "_images");
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.mkdirSync(newDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, "msg-old-0.png"), Buffer.from("OLD"));
        fs.writeFileSync(path.join(newDir, "msg-new-0.png"), Buffer.from("NEW"));
        const session = {
            meta: { id: "session-mixed" },
            messages: [
                {
                    id: "msg-old",
                    role: "user",
                    content: "old",
                    images: [{ mimeType: "image/png", imageFile: "msg-old-0.png" }],
                },
                {
                    id: "msg-new",
                    role: "user",
                    content: "new",
                    images: [{ mimeType: "image/png", imageFile: "msg-new-0.png" }],
                },
            ],
        };

        const hydrated = hydrateSessionImages(session, dir);
        assert.equal(hydrated.messages[0].images[0].dataUrl, "data:image/png;base64,T0xE");
        assert.equal(hydrated.messages[1].images[0].dataUrl, "data:image/png;base64,TkVX");
    });

    it("reads image files directly from legacy split _Images storage", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-img-read-"));
        const sessionId = "647de089-e74a-4666-869a-d52fcceeb7a7";
        const legacyDir = path.join(sessionDir(dir, sessionId), "_Images");
        fs.mkdirSync(legacyDir, { recursive: true });
        const imageFile = `${sessionId}-0.png`;
        fs.writeFileSync(path.join(legacyDir, imageFile), Buffer.from("ABC"));

        const loaded = readSessionImageFile(dir, sessionId, imageFile, "image/png");
        assert.equal(loaded?.mimeType, "image/png");
        assert.equal(loaded?.dataUrl, "data:image/png;base64,QUJD");
    });

    it("hydrates images from legacy split _Images storage", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-img-split-legacy-"));
        const legacyDir = path.join(sessionDir(dir, "session-split-legacy"), "_Images");
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, "msg-1-0.png"), Buffer.from("ABC"));
        const session = {
            meta: { id: "session-split-legacy" },
            messages: [
                {
                    id: "msg-1",
                    role: "user",
                    content: "pic",
                    images: [{ mimeType: "image/png", imageFile: "msg-1-0.png" }],
                },
            ],
        };

        const hydrated = hydrateSessionImages(session, dir);
        assert.equal(hydrated.messages[0].images[0].dataUrl, "data:image/png;base64,QUJD");
    });
});

describe("SessionStore image migration", () => {
    it("rewrites legacy inline images on first get", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-store-"));
        const sessionsDir = path.join(dir, "sessions");
        fs.mkdirSync(sessionsDir, { recursive: true });
        const sessionId = "legacy-session";
        fs.writeFileSync(
            path.join(sessionsDir, `${sessionId}.json`),
            JSON.stringify(
                {
                    meta: { id: sessionId, title: "legacy", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
                    messages: [
                        {
                            id: "msg-1",
                            role: "user",
                            content: "pic",
                            images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,QUJD" }],
                        },
                    ],
                },
                null,
                2,
            ),
            "utf-8",
        );

        const store = new SessionStore(sessionsDir, { providerKey: "openai", modelId: "gpt-4o-mini" }, null);
        const uiSession = store.get(sessionId, { hydrateImages: false });
        assert.equal(sessionHasInlineImages(uiSession), false);

        assert.equal(fs.existsSync(metaFile(sessionsDir, sessionId)), true);
        const raw = fs.readFileSync(messagesFile(sessionsDir, sessionId), "utf-8");
        assert.equal(raw.includes("dataUrl"), false);
        assert.equal(raw.includes("imageFile"), true);
    });

    it("can load externalized message images by message id", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-store-image-get-"));
        const sessionsDir = path.join(dir, "sessions");
        fs.mkdirSync(sessionsDir, { recursive: true });
        const store = new SessionStore(
            sessionsDir,
            { providerKey: "openai", modelId: "gpt-4o-mini" },
            null,
        );
        const session = store.newSession();
        store.appendMessage(session.meta.id, {
            id: "assistant-image",
            role: "assistant",
            content: "![image](data:image/png;base64,QUJD)",
            createdAt: new Date().toISOString(),
        });

        const stored = store.get(session.meta.id, { hydrateImages: false });
        assert.equal(stored.messages[0].content, "");
        assert.equal(stored.messages[0].images[0].dataUrl, undefined);

        const image = store.getMessageImage(session.meta.id, "assistant-image", 0);
        assert.equal(image.mimeType, "image/png");
        assert.equal(image.dataUrl, "data:image/png;base64,QUJD");
    });

    it("can load externalized user images by imageFile from _Images", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-store-user-image-"));
        const sessionsDir = path.join(dir, "sessions");
        fs.mkdirSync(sessionsDir, { recursive: true });
        const store = new SessionStore(
            sessionsDir,
            { providerKey: "openai", modelId: "gpt-4o-mini" },
            null,
        );
        const session = store.newSession();
        const messageId = "647de089-e74a-4666-869a-d52fcceeb7a7";
        store.appendMessage(session.meta.id, {
            id: messageId,
            role: "user",
            content: "pic",
            createdAt: new Date().toISOString(),
            images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,QUJD" }],
        });

        const imageFile = `${messageId}-0.png`;
        const image = store.getMessageImage(
            session.meta.id,
            messageId,
            0,
            imageFile,
            "image/png",
        );
        assert.equal(image.mimeType, "image/png");
        assert.equal(image.dataUrl, "data:image/png;base64,QUJD");
    });
});
