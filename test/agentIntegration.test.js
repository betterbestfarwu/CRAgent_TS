import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentRuntime } from "../src/main/agentRuntime.js";
import { ConfigStore } from "../src/main/configStore.js";
import { LlmClient } from "../src/main/llmClient.js";
import { SessionStore } from "../src/main/sessionStore.js";
import { ToolRegistry } from "../src/main/toolRegistry.js";
import { createMetaTools } from "../src/main/tools/metaTools.js";

function makeTempConfig() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-test-"));
    const configFile = path.join(dir, "config.json");
    const store = new ConfigStore(configFile);
    store.update({
        ...store.get(),
        agents: {
            ...store.get().agents,
            default: {
                ...store.get().agents.default,
                model: {
                    primary: "openai/gpt-4o-mini",
                    fallbacks: ["openai/gpt-5"],
                },
            },
            list: [
                {
                    id: "main",
                    name: "main",
                    is_default: true,
                    max_tool_rounds: 4,
                    tools: {
                        enable_tools: true,
                        enable_file_tools: true,
                        enable_skills: true,
                        allow_sub_agents: true,
                    },
                },
            ],
        },
        models: {
            openai: {
                baseUrl: "https://api.example.com/v1",
                apiKey: "sk-test-key",
                api: "chat/completions",
                state: true,
                models: [
                    { id: "gpt-4o-mini", name: "gpt-4o-mini", state: true },
                    { id: "gpt-5", name: "gpt-5", state: true },
                ],
            },
        },
    });
    return { dir, store };
}

function makeRuntimeHarness(options = {}) {
    const { dir, store: configStore } = makeTempConfig();
    const sessionsDir = path.join(dir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionStore = new SessionStore(sessionsDir, configStore.resolvePrimaryRef());
    const session = sessionStore.newSession();

    const events = {
        todosChanged: [],
        messageAppended: [],
        sessionChanged: [],
        busyChanged: [],
        errors: [],
    };

    const llmCalls = [];
    const llmClient = {
        chat: async (args) => {
            llmCalls.push(args);
            if (options.chatImpl) {
                return options.chatImpl(args, llmCalls.length);
            }
            return {
                message: {
                    id: "assistant-1",
                    role: "assistant",
                    content: "ok",
                    createdAt: new Date().toISOString(),
                },
            };
        },
        complete: async () => ({
            message: {
                id: "assistant-complete",
                role: "assistant",
                content: "summary",
                createdAt: new Date().toISOString(),
            },
        }),
    };

    const toolRegistry = new ToolRegistry(() => {
        const meta = createMetaTools({
            getAgentTools: () => configStore.get().agents.list[0].tools,
            updateTodos: (sessionId, todos, merge) => runtime.updateTodos(sessionId, todos, merge),
            runSubAgent: (args) => runtime.runSubAgent(args),
        });
        return meta;
    });

    const runtime = new AgentRuntime(
        sessionStore,
        configStore,
        llmClient,
        toolRegistry,
        { bootstrapSystemContent: () => "" },
        { systemPromptSection: () => "", reload: () => {} },
        () => null,
    );

    runtime.emit = (channel, payload) => {
        if (channel === "events:todosChanged") events.todosChanged.push(payload);
        if (channel === "events:messageAppended") events.messageAppended.push(payload);
        if (channel === "events:sessionChanged") events.sessionChanged.push(payload);
        if (channel === "events:busyChanged") events.busyChanged.push(payload);
        if (channel === "events:error") events.errors.push(payload);
    };

    return { dir, configStore, sessionStore, session, runtime, events, llmCalls, toolRegistry };
}

test("ConfigStore.resolveModelChain includes session model and configured fallbacks", () => {
    const { store } = makeTempConfig();
    const chain = store.resolveModelChain("openai", "gpt-4o-mini");
    assert.deepEqual(chain, [
        { providerKey: "openai", modelId: "gpt-4o-mini" },
        { providerKey: "openai", modelId: "gpt-5" },
    ]);
});

test("LlmClient retries fallback models when primary request fails", async () => {
    const attempts = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(init.body);
        attempts.push(body.model);
        if (body.model === "gpt-4o-mini") {
            return new Response("rate limited", { status: 429 });
        }
        return new Response(
            JSON.stringify({
                choices: [{ message: { role: "assistant", content: "fallback ok" } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    };

    try {
        const client = new LlmClient(() => ({
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-test",
            api: "chat/completions",
        }));
        const result = await client.chat({
            model: { providerKey: "openai", modelId: "gpt-4o-mini" },
            modelChain: [
                { providerKey: "openai", modelId: "gpt-4o-mini" },
                { providerKey: "openai", modelId: "gpt-5" },
            ],
            messages: [{ role: "user", content: "hello" }],
        });
        assert.deepEqual(attempts, ["gpt-4o-mini", "gpt-5"]);
        assert.equal(result.usedFallback, true);
        assert.equal(result.message.content, "fallback ok");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("TodoWrite tool updates session todos and emits todosChanged", async () => {
    const { session, runtime, events, sessionStore } = makeRuntimeHarness();
    const result = await runtime.toolRegistry.execute(
        {
            id: "call-todo",
            function: {
                name: "TodoWrite",
                arguments: JSON.stringify({
                    merge: false,
                    todos: [
                        { id: "1", content: "Implement fallback", status: "in_progress" },
                        { id: "2", content: "Add tests", status: "pending" },
                    ],
                }),
            },
        },
        { sessionId: session.meta.id, runId: "run-1" },
    );

    assert.match(result, /Updated todo list \(2 items\)/);
    const updated = sessionStore.get(session.meta.id);
    assert.equal(updated.meta.todos.length, 2);
    assert.equal(updated.meta.todos[0].status, "in_progress");
    assert.equal(events.todosChanged.length, 1);
    assert.equal(events.todosChanged[0].todos.length, 2);
});

test("TodoWrite merge=true updates items by id", async () => {
    const { session, runtime, sessionStore } = makeRuntimeHarness();
    runtime.updateTodos(
        session.meta.id,
        [{ id: "1", content: "First", status: "pending" }],
        false,
    );
    await runtime.toolRegistry.execute(
        {
            id: "call-todo-merge",
            function: {
                name: "TodoWrite",
                arguments: JSON.stringify({
                    merge: true,
                    todos: [{ id: "1", content: "First", status: "completed" }],
                }),
            },
        },
        { sessionId: session.meta.id },
    );
    const updated = sessionStore.get(session.meta.id);
    assert.deepEqual(updated.meta.todos, [
        { id: "1", content: "First", status: "completed" },
    ]);
});

test("Task tool is hidden unless allow_sub_agents is enabled", () => {
    const enabled = makeRuntimeHarness();
    const namesEnabled = enabled.toolRegistry.activeTools().map((tool) => tool.name);
    assert.ok(namesEnabled.includes("Task"));
    assert.ok(namesEnabled.includes("TodoWrite"));

    const disabled = makeRuntimeHarness();
    disabled.configStore.get().agents.list[0].tools.allow_sub_agents = false;
    const namesDisabled = disabled.toolRegistry.activeTools().map((tool) => tool.name);
    assert.ok(!namesDisabled.includes("Task"));
    assert.ok(namesDisabled.includes("TodoWrite"));
});

test("runSubAgent returns isolated result without polluting main session history", async () => {
    const { session, runtime, sessionStore } = makeRuntimeHarness({
        chatImpl: () => ({
            message: {
                id: "sub-assistant",
                role: "assistant",
                content: "explored codebase structure",
                createdAt: new Date().toISOString(),
            },
        }),
    });

    const beforeCount = sessionStore.get(session.meta.id).messages.length;
    const result = await runtime.runSubAgent({
        sessionId: session.meta.id,
        parentRunId: "parent-run",
        description: "explore repo",
        prompt: "Summarize project layout",
        subagentType: "explore",
    });

    assert.match(result, /explored codebase structure/);
    const after = sessionStore.get(session.meta.id);
    assert.equal(after.messages.length, beforeCount);
});

test("runLoop annotates assistant message when fallback model is used", async () => {
    const { session, runtime, events } = makeRuntimeHarness({
        chatImpl: () => ({
            usedFallback: true,
            usedModel: { providerKey: "openai", modelId: "gpt-5" },
            message: {
                id: "assistant-main",
                role: "assistant",
                content: "main reply",
                createdAt: new Date().toISOString(),
            },
        }),
    });

    await runtime.runLoop(session, "run-main");
    const assistant = events.messageAppended.find(
        (entry) => entry.message.role === "assistant",
    )?.message;
    assert.ok(assistant);
    assert.match(assistant.content, /已自动切换至备用模型 openai\/gpt-5/);
    assert.match(assistant.content, /main reply/);
});

test("messagesForLLM injects active todos into system prompt", () => {
    const { session, runtime } = makeRuntimeHarness();
    runtime.updateTodos(
        session.meta.id,
        [{ id: "t1", content: "Write tests", status: "in_progress" }],
        false,
    );
    const refreshed = runtime.sessionStore.get(session.meta.id);
    const messages = runtime.messagesForLLM(refreshed);
    const system = messages.find((message) => message.role === "system");
    assert.ok(system);
    assert.match(system.content, /<active_todos>/);
    assert.match(system.content, /Write tests/);
});
