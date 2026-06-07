import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectMessagesUpToTurn, findTurnEndIndex, CONTEXT_DIVIDER_LABEL, CONTEXT_DIVIDER_ROLE, CONTEXT_COMPACT_DIVIDER_LABEL, resolveForkLlmContext } from "../src/shared/chatMessages.js";
import {
    buildForkedSession,
    cloneMessagesForFork,
    remapTodoRunsForFork,
} from "../src/shared/sessionFork.js";
import { SessionStore } from "../src/main/sessionStore.js";
import { messagesFile, metaFile } from "../src/main/sessionStorage.js";

describe("collectMessagesUpToTurn", () => {
    it("includes earlier turns and the selected completed run", () => {
        const messages = [
            { id: "u1", role: "user", content: "first", runId: "run-1" },
            { id: "a1", role: "assistant", content: "reply 1", runId: "run-1" },
            { id: "u2", role: "user", content: "second", runId: "run-2" },
            { id: "t1", role: "assistant", toolCalls: [{ id: "tc1", function: { name: "Read" } }], runId: "run-2" },
            { id: "tr1", role: "tool", toolCallId: "tc1", content: "ok", runId: "run-2" },
            { id: "a2", role: "assistant", content: "reply 2", runId: "run-2" },
            { id: "u3", role: "user", content: "third", runId: "run-3" },
        ];

        const forked = collectMessagesUpToTurn(messages, "a2");
        assert.deepEqual(
            forked.map((message) => message.id),
            ["u1", "a1", "u2", "t1", "tr1", "a2"],
        );
    });

    it("returns empty when message id is missing", () => {
        assert.deepEqual(collectMessagesUpToTurn([], "missing"), []);
    });
});

describe("findTurnEndIndex", () => {
    it("extends through all messages in the same run", () => {
        const messages = [
            { id: "u1", role: "user", content: "hi", runId: "run-1" },
            { id: "a1", role: "assistant", content: "done", runId: "run-1" },
        ];
        assert.equal(findTurnEndIndex(messages, "u1"), 1);
        assert.equal(findTurnEndIndex(messages, "a1"), 1);
    });
});

describe("cloneMessagesForFork", () => {
    it("remaps message ids, run ids, and tool call refs", () => {
        let counter = 0;
        const createId = () => `new-${++counter}`;
        const { messages, runIdMap } = cloneMessagesForFork(
            [
                { id: "u1", role: "user", content: "hi", runId: "run-1" },
                {
                    id: "a1",
                    role: "assistant",
                    toolCalls: [{ id: "tc1", function: { name: "Read", arguments: "{}" } }],
                    runId: "run-1",
                },
                { id: "t1", role: "tool", toolCallId: "tc1", content: "ok", runId: "run-1" },
                { id: "a2", role: "assistant", content: "done", runId: "run-1" },
            ],
            createId,
        );

        assert.equal(messages.length, 4);
        assert.ok(messages.every((message) => message.id.startsWith("new-")));
        assert.equal(runIdMap.size, 1);
        assert.equal(messages[0].runId, messages[3].runId);
        assert.notEqual(messages[0].runId, "run-1");
        assert.equal(messages[2].toolCallId, messages[1].toolCalls[0].id);
    });
});

describe("remapTodoRunsForFork", () => {
    it("copies todo snapshots onto remapped run ids", () => {
        const todoRuns = remapTodoRunsForFork(
            { "run-1": { todos: [{ content: "task", status: "completed" }], updatedAt: "t" } },
            new Map([["run-1", "run-new"]]),
        );
        assert.deepEqual(todoRuns["run-new"].todos[0].content, "task");
    });
});

describe("SessionStore.forkSession", () => {
    it("creates a new session with messages up to the selected turn", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-fork-"));
        const store = new SessionStore(dir, { providerKey: "openai", modelId: "gpt-4o-mini" });
        const source = store.newSession();
        store.appendMessage(source.meta.id, {
            id: "u1",
            role: "user",
            content: "hello",
            runId: "run-1",
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "a1",
            role: "assistant",
            content: "world",
            runId: "run-1",
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "u2",
            role: "user",
            content: "again",
            runId: "run-2",
            createdAt: new Date().toISOString(),
        });

        const forked = store.forkSession(source.meta.id, "a1");
        assert.notEqual(forked.meta.id, source.meta.id);
        assert.equal(forked.messages.length, 2);
        assert.equal(forked.messages[0].content, "hello");
        assert.equal(forked.messages[1].content, "world");
        assert.notEqual(forked.messages[0].id, "u1");
        assert.notEqual(forked.messages[1].id, "a1");
    });
});

describe("SessionStore.removeMessages", () => {
    it("keeps llmContextDividerId when deleting messages before divider", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-remove-msg-"));
        const store = new SessionStore(dir, { providerKey: "openai", modelId: "gpt-4o-mini" });
        const source = store.newSession();
        store.appendMessage(source.meta.id, {
            id: "u0",
            role: "user",
            content: "before divider",
            runId: "run-0",
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "d1",
            role: CONTEXT_DIVIDER_ROLE,
            content: CONTEXT_DIVIDER_LABEL,
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "u1",
            role: "user",
            content: "after divider",
            runId: "run-1",
            createdAt: new Date().toISOString(),
        });
        store.save({
            meta: { ...store.get(source.meta.id).meta, llmContextDividerId: "d1" },
            messages: store.get(source.meta.id, { loadAllMessages: true }).messages,
        });

        const updated = store.removeMessages(source.meta.id, ["u0"]);
        assert.equal(updated.messages.length, 2);
        assert.equal(updated.messages[0].id, "d1");
        assert.equal(updated.meta.llmContextDividerId, "d1");
        assert.equal(updated.meta.llmContextFromIndex, undefined);

        const lines = fs
            .readFileSync(messagesFile(dir, source.meta.id), "utf-8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        assert.equal(lines[0].llmContextFromIndex, undefined);
    });

    it("persists meta.llmContextDividerId to meta.json after deletion", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-meta-sync-"));
        const store = new SessionStore(dir, { providerKey: "openai", modelId: "gpt-4o-mini" });
        const source = store.newSession();
        store.appendMessage(source.meta.id, {
            id: "u0",
            role: "user",
            content: "before",
            runId: "run-0",
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "u1",
            role: "user",
            content: "also before",
            runId: "run-1",
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "d1",
            role: CONTEXT_DIVIDER_ROLE,
            content: CONTEXT_DIVIDER_LABEL,
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "u2",
            role: "user",
            content: "after",
            runId: "run-2",
            createdAt: new Date().toISOString(),
        });
        store.save({
            meta: { ...store.get(source.meta.id).meta, llmContextDividerId: "d1" },
            messages: store.get(source.meta.id, { loadAllMessages: true }).messages,
        });

        const updated = store.removeMessages(source.meta.id, ["u0", "u1"]);
        assert.equal(updated.messages[0].id, "d1");
        assert.equal(updated.meta.llmContextDividerId, "d1");

        const metaOnDisk = JSON.parse(fs.readFileSync(metaFile(dir, source.meta.id), "utf-8"));
        assert.equal(metaOnDisk.llmContextDividerId, "d1");
        assert.equal(metaOnDisk.llmContextFromIndex, undefined);
    });

    it("removes orphan dividers when last conversation message is deleted", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-remove-divider-"));
        const store = new SessionStore(dir, { providerKey: "openai", modelId: "gpt-4o-mini" });
        const source = store.newSession();
        store.appendMessage(source.meta.id, {
            id: "d1",
            role: CONTEXT_DIVIDER_ROLE,
            content: CONTEXT_DIVIDER_LABEL,
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "u1",
            role: "user",
            content: "last message",
            runId: "run-1",
            createdAt: new Date().toISOString(),
        });
        store.save({
            meta: {
                ...store.get(source.meta.id).meta,
                llmContextDividerId: "d1",
                contextSummary: "old summary",
            },
            messages: store.get(source.meta.id, { loadAllMessages: true }).messages,
        });

        const updated = store.removeMessages(source.meta.id, ["u1"]);
        assert.deepEqual(updated.messages, []);
        assert.equal(updated.meta.llmContextDividerId, undefined);
        assert.equal(updated.meta.contextSummary, undefined);
        assert.equal(fs.existsSync(messagesFile(dir, source.meta.id)), false);
    });

    it("removes adjacent divider after deletion between dividers", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-adj-divider-"));
        const store = new SessionStore(dir, { providerKey: "openai", modelId: "gpt-4o-mini" });
        const source = store.newSession();
        store.appendMessage(source.meta.id, {
            id: "u1",
            role: "user",
            content: "old",
            runId: "run-1",
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "d1",
            role: CONTEXT_DIVIDER_ROLE,
            content: CONTEXT_DIVIDER_LABEL,
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "d2",
            role: CONTEXT_DIVIDER_ROLE,
            content: CONTEXT_COMPACT_DIVIDER_LABEL,
            contextSummary: "summary",
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "u2",
            role: "user",
            content: "between",
            runId: "run-2",
            createdAt: new Date().toISOString(),
        });
        store.appendMessage(source.meta.id, {
            id: "u3",
            role: "user",
            content: "new",
            runId: "run-3",
            createdAt: new Date().toISOString(),
        });
        store.save({
            meta: {
                ...store.get(source.meta.id).meta,
                llmContextDividerId: "d2",
                contextSummary: "summary",
            },
            messages: store.get(source.meta.id, { loadAllMessages: true }).messages,
        });

        const updated = store.removeMessages(source.meta.id, ["u2"]);
        assert.deepEqual(
            updated.messages.map((message) => message.id),
            ["u1", "d1", "u3"],
        );
        assert.equal(updated.meta.llmContextDividerId, "d1");
        assert.equal(updated.meta.contextSummary, undefined);

        const lines = fs
            .readFileSync(messagesFile(dir, source.meta.id), "utf-8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        assert.deepEqual(
            lines.map((message) => message.id),
            ["u1", "d1", "u3"],
        );
    });
});

describe("buildForkedSession", () => {
    it("preserves model and execution settings from the source session", () => {
        const source = {
            meta: {
                id: "s1",
                title: "Branch me",
                providerKey: "openai",
                modelId: "gpt-4o",
                executionMode: "plan",
                authMode: "api_key",
                projectId: null,
            },
            messages: [
                { id: "u1", role: "user", content: "hi", runId: "run-1" },
                { id: "a1", role: "assistant", content: "ok", runId: "run-1" },
            ],
        };
        const forked = buildForkedSession(source, "a1", () => ({
            meta: {
                id: "s2",
                title: "新会话",
                providerKey: "anthropic",
                modelId: "claude",
                executionMode: "goal",
                authMode: "oauth",
                createdAt: "t",
                updatedAt: "t",
            },
            messages: [],
        }));
        assert.equal(forked.meta.modelId, "gpt-4o");
        assert.equal(forked.meta.executionMode, "plan");
        assert.equal(forked.meta.authMode, "api_key");
        assert.equal(forked.meta.title, "Branch me");
    });

    it("sends all forked messages when parent compression is outside the slice", () => {
        const source = {
            meta: {
                id: "s1",
                title: "Compressed",
                providerKey: "openai",
                modelId: "gpt-4o",
                llmContextFromIndex: 4,
                contextSummary: "summary of earlier turns",
                postCompactContext: "restored file context",
            },
            messages: [
                { id: "u1", role: "user", content: "first", runId: "run-1" },
                { id: "a1", role: "assistant", content: "reply 1", runId: "run-1" },
                { id: "u2", role: "user", content: "second", runId: "run-2" },
                { id: "a2", role: "assistant", content: "reply 2", runId: "run-2" },
            ],
        };
        const forked = buildForkedSession(source, "a2", () => ({
            meta: { id: "s2", title: "新会话", createdAt: "t", updatedAt: "t" },
            messages: [],
        }));

        assert.equal(forked.meta.llmContextFromIndex, undefined);
        assert.equal(forked.meta.contextSummary, undefined);
        assert.equal(forked.meta.postCompactContext, undefined);
        assert.equal(forked.messages.length, 4);
    });

    it("respects /clear divider inside the forked slice", () => {
        const source = {
            meta: {
                id: "s1",
                title: "Cleared",
                llmContextDividerId: "d1",
            },
            messages: [
                { id: "u1", role: "user", content: "old", runId: "run-1" },
                { id: "a1", role: "assistant", content: "old reply", runId: "run-1" },
                {
                    id: "d1",
                    role: CONTEXT_DIVIDER_ROLE,
                    content: CONTEXT_DIVIDER_LABEL,
                },
                { id: "u2", role: "user", content: "new", runId: "run-2" },
                { id: "a2", role: "assistant", content: "new reply", runId: "run-2" },
            ],
        };
        const forked = buildForkedSession(source, "a2", () => ({
            meta: { id: "s2", title: "新会话", createdAt: "t", updatedAt: "t" },
            messages: [],
        }));

        assert.ok(forked.meta.llmContextDividerId);
        assert.notEqual(forked.meta.llmContextDividerId, "d1");
        assert.equal(forked.meta.contextSummary, undefined);
        assert.equal(forked.messages.length, 5);
    });

    it("respects /compact divider and summary inside the forked slice", () => {
        const source = {
            meta: {
                id: "s1",
                title: "Compacted",
                llmContextDividerId: "d1",
                contextSummary: "meta summary",
                postCompactContext: "meta restored",
            },
            messages: [
                { id: "u1", role: "user", content: "old", runId: "run-1" },
                { id: "a1", role: "assistant", content: "old reply", runId: "run-1" },
                {
                    id: "d1",
                    role: CONTEXT_DIVIDER_ROLE,
                    content: CONTEXT_COMPACT_DIVIDER_LABEL,
                    contextSummary: "divider summary",
                    postCompactContext: "divider restored",
                },
                { id: "u2", role: "user", content: "new", runId: "run-2" },
                { id: "a2", role: "assistant", content: "new reply", runId: "run-2" },
            ],
        };
        const forked = buildForkedSession(source, "a2", () => ({
            meta: { id: "s2", title: "新会话", createdAt: "t", updatedAt: "t" },
            messages: [],
        }));

        assert.ok(forked.meta.llmContextDividerId);
        assert.equal(forked.meta.contextSummary, "divider summary");
        assert.equal(forked.meta.postCompactContext, "divider restored");
    });
});

describe("resolveForkLlmContext", () => {
    it("uses the last divider in the slice", () => {
        const messages = [
            { id: "d1", role: CONTEXT_DIVIDER_ROLE, content: CONTEXT_DIVIDER_LABEL },
            { role: "user", content: "between" },
            { id: "d2", role: CONTEXT_DIVIDER_ROLE, content: CONTEXT_DIVIDER_LABEL },
            { role: "user", content: "after" },
        ];
        const resolved = resolveForkLlmContext(messages);
        assert.equal(resolved.llmContextDividerId, "d2");
    });

    it("derives divider id from legacy dividers without stored meta", () => {
        const messages = [
            { role: "user", content: "old" },
            { id: "d1", role: CONTEXT_DIVIDER_ROLE, content: CONTEXT_DIVIDER_LABEL },
            { role: "user", content: "new" },
        ];
        const resolved = resolveForkLlmContext(messages);
        assert.equal(resolved.llmContextDividerId, "d1");
    });
});
