import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_UI_MESSAGE_PAGE } from "../src/shared/sessionPaging.js";
import { SessionStore } from "../src/main/sessionStore.js";
import {
    isSplitSession,
    legacySessionFile,
    listSessionEntries,
    messagesFile,
    metaFile,
    migrateLegacySessionIfNeeded,
    moveSessionStorage,
    readMessages,
    sessionDir,
    writeMeta,
    writeSplitSession,
} from "../src/main/sessionStorage.js";

describe("sessionStorage", () => {
    it("migrates legacy monolithic json to meta + ndjson", () => {
        const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-split-"));
        const sessionId = "legacy-1";
        fs.writeFileSync(
            legacySessionFile(sessionsDir, sessionId),
            JSON.stringify({
                meta: {
                    id: sessionId,
                    title: "t",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                },
                messages: [
                    { id: "m1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" },
                ],
            }),
            "utf-8",
        );

        assert.equal(migrateLegacySessionIfNeeded(sessionsDir, sessionId), true);
        assert.equal(fs.existsSync(legacySessionFile(sessionsDir, sessionId)), false);
        assert.equal(isSplitSession(sessionsDir, sessionId), true);
        assert.equal(readMessages(sessionsDir, sessionId).totalCount, 1);
    });

    it("reads tail and older pages from ndjson", () => {
        const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-page-"));
        const sessionId = "page-1";
        const messages = Array.from({ length: 5 }, (_v, index) => ({
            id: `m${index}`,
            role: "user",
            content: `msg-${index}`,
            createdAt: "2026-01-01T00:00:00.000Z",
        }));
        writeSplitSession(sessionsDir, {
            meta: {
                id: sessionId,
                title: "paged",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
            messages,
        });

        const tail = readMessages(sessionsDir, sessionId, { limit: 2 });
        assert.equal(tail.messages.length, 2);
        assert.equal(tail.messages[0].id, "m3");
        assert.equal(tail.hasMoreBefore, true);

        const older = readMessages(sessionsDir, sessionId, {
            beforeMessageId: "m3",
            limit: 2,
        });
        assert.deepEqual(
            older.messages.map((message) => message.id),
            ["m1", "m2"],
        );
    });

    it("reads tail pages without parsing the full ndjson file", () => {
        const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-tail-opt-"));
        const sessionId = "tail-opt";
        const messages = Array.from({ length: 120 }, (_v, index) => ({
            id: `m${index}`,
            role: index % 2 === 0 ? "user" : "assistant",
            content: `payload-${index}`,
            createdAt: "2026-01-01T00:00:00.000Z",
        }));
        writeSplitSession(sessionsDir, {
            meta: {
                id: sessionId,
                title: "tail",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
            messages,
        });

        const tail = readMessages(sessionsDir, sessionId, { limit: 10 });
        assert.equal(tail.totalCount, 120);
        assert.equal(tail.messages.length, 10);
        assert.deepEqual(
            tail.messages.map((message) => message.id),
            ["m110", "m111", "m112", "m113", "m114", "m115", "m116", "m117", "m118", "m119"],
        );
        assert.equal(tail.hasMoreBefore, true);
    });

    it("moves legacy global images into the split _images directory", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-move-images-"));
        const fromDir = path.join(dir, "from");
        const toDir = path.join(dir, "to");
        const sessionId = "move-img";
        const legacyImages = path.join(fromDir, "_images", sessionId);
        fs.mkdirSync(legacyImages, { recursive: true });
        fs.writeFileSync(path.join(legacyImages, "m1-0.png"), Buffer.from("ABC"));

        moveSessionStorage(fromDir, toDir, sessionId);

        assert.equal(
            fs.existsSync(path.join(sessionDir(toDir, sessionId), "_images", "m1-0.png")),
            true,
        );
        assert.equal(fs.existsSync(legacyImages), false);
    });

    it("ignores reserved underscore directories when listing sessions", () => {
        const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-reserved-"));
        const reservedDir = path.join(sessionsDir, "_layout");
        fs.mkdirSync(reservedDir, { recursive: true });
        fs.writeFileSync(path.join(reservedDir, "meta.json"), "{}", "utf-8");

        assert.deepEqual(listSessionEntries(sessionsDir), []);
    });
});

describe("SessionStore split layout", () => {
    it("applies requested modes when reusing a placeholder session", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-placeholder-mode-"));
        const sessionsDir = path.join(dir, "sessions");
        fs.mkdirSync(sessionsDir, { recursive: true });
        const store = new SessionStore(
            sessionsDir,
            { providerKey: "openai", modelId: "gpt-4o-mini" },
            null,
        );

        const placeholder = store.listMetas()[0];
        assert.equal(placeholder.executionMode, "goal");

        const reused = store.openNewSession({
            executionMode: "plan",
            authMode: "autoReview",
        });

        assert.equal(reused.meta.id, placeholder.id);
        assert.equal(reused.meta.executionMode, "plan");
        assert.equal(reused.meta.authMode, "autoReview");
        assert.equal(store.get(placeholder.id).meta.executionMode, "plan");
    });

    it("uses the latest default model when creating and reusing blank sessions", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-default-model-"));
        const sessionsDir = path.join(dir, "sessions");
        fs.mkdirSync(sessionsDir, { recursive: true });
        let defaultModel = { providerKey: "openai", modelId: "gpt-4o-mini" };
        const store = new SessionStore(sessionsDir, () => defaultModel, null);

        const placeholder = store.listMetas()[0];
        assert.equal(placeholder.providerKey, "openai");
        assert.equal(placeholder.modelId, "gpt-4o-mini");

        defaultModel = { providerKey: "anthropic", modelId: "claude-opus-4-5" };
        const reused = store.openNewSession();
        assert.equal(reused.meta.id, placeholder.id);
        assert.equal(reused.meta.providerKey, "anthropic");
        assert.equal(reused.meta.modelId, "claude-opus-4-5");
        assert.equal(store.get(placeholder.id).meta.providerKey, "anthropic");

        store.appendMessage(reused.meta.id, {
            id: "u1",
            role: "user",
            content: "hi",
            createdAt: new Date().toISOString(),
        });

        defaultModel = { providerKey: "google", modelId: "gemini-2.5-pro" };
        const created = store.openNewSession();
        assert.notEqual(created.meta.id, placeholder.id);
        assert.equal(created.meta.providerKey, "google");
        assert.equal(created.meta.modelId, "gemini-2.5-pro");
    });

    it("appends messages without rewriting the full log", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-store-split-"));
        const sessionsDir = path.join(dir, "sessions");
        fs.mkdirSync(sessionsDir, { recursive: true });
        const store = new SessionStore(sessionsDir, { providerKey: "openai", modelId: "gpt-4o-mini" }, null);
        const created = store.newSession();
        store.appendMessage(created.meta.id, {
            id: "u1",
            role: "user",
            content: "hi",
            createdAt: new Date().toISOString(),
        });

        const locatedDir = store.locateSessionStorage(created.meta.id);
        const raw = fs.readFileSync(messagesFile(locatedDir, created.meta.id), "utf-8");
        assert.equal(raw.trim().split("\n").length, 1);
        assert.equal(fs.existsSync(metaFile(locatedDir, created.meta.id)), true);
    });

    it("migrates direct standalone sessions into the GUID session root", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-standalone-migrate-"));
        const sessionsDir = path.join(dir, "sessions");
        fs.mkdirSync(sessionsDir, { recursive: true });
        const sessionId = "legacy-standalone";
        const timestamp = new Date().toISOString();
        writeMeta(sessionsDir, {
            id: sessionId,
            title: "新会话",
            providerKey: "openai",
            modelId: "gpt-4o-mini",
            projectId: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            todos: [],
        });

        const store = new SessionStore(
            sessionsDir,
            { providerKey: "openai", modelId: "gpt-4o-mini" },
            null,
        );
        const layout = store.sessionTreeLayout;
        const standaloneRoot = path.join(sessionsDir, layout.sessionsRootId);

        assert.equal(fs.existsSync(sessionDir(sessionsDir, sessionId)), false);
        assert.equal(fs.existsSync(sessionDir(standaloneRoot, sessionId)), true);
        assert.equal(store.locateSessionStorage(sessionId), standaloneRoot);
    });

    it("returns paginated messages for UI get", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-store-page-"));
        const sessionsDir = path.join(dir, "sessions");
        fs.mkdirSync(sessionsDir, { recursive: true });
        const store = new SessionStore(sessionsDir, { providerKey: "openai", modelId: "gpt-4o-mini" }, null);
        const sessionId = "ui-page";
        const messages = Array.from({ length: DEFAULT_UI_MESSAGE_PAGE + 3 }, (_v, index) => ({
            id: `m${index}`,
            role: "user",
            content: `c${index}`,
            createdAt: "2026-01-01T00:00:00.000Z",
        }));
        writeSplitSession(sessionsDir, {
            meta: {
                id: sessionId,
                title: "big",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
            messages,
        });

        const uiSession = store.get(sessionId, {
            hydrateImages: false,
            messageLimit: DEFAULT_UI_MESSAGE_PAGE,
        });
        assert.equal(uiSession.messages.length, DEFAULT_UI_MESSAGE_PAGE);
        assert.equal(uiSession.meta.hasMoreMessages, true);
        assert.equal(uiSession.meta.messageCount, DEFAULT_UI_MESSAGE_PAGE + 3);
    });
});
