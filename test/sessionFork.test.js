import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectMessagesUpToTurn, findTurnEndIndex } from "../src/shared/chatMessages.js";
import {
    buildForkedSession,
    cloneMessagesForFork,
    remapTodoRunsForFork,
} from "../src/shared/sessionFork.js";
import { SessionStore } from "../src/main/sessionStore.js";

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
});
