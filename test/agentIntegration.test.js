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
    const llmCompleteCalls = [];
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
        complete: async (args) => {
            llmCompleteCalls.push(args);
            if (options.completeImpl) {
                return options.completeImpl(args, llmCompleteCalls.length);
            }
            return {
                message: {
                    id: "assistant-complete",
                    role: "assistant",
                    content: "summary",
                    createdAt: new Date().toISOString(),
                },
            };
        },
    };

    const toolRegistry = new ToolRegistry(() => {
        const meta = createMetaTools({
            getAgentTools: () => configStore.get().agents.list[0].tools,
            updateTodos: (sessionId, todos, merge, runId) =>
                runtime.updateTodos(sessionId, todos, merge, runId),
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
        { systemPromptSection: () => "", listSummaries: () => [], reload: () => {} },
        () => null,
    );

    runtime.emit = (channel, payload) => {
        if (channel === "events:todosChanged") events.todosChanged.push(payload);
        if (channel === "events:messageAppended") events.messageAppended.push(payload);
        if (channel === "events:sessionChanged") events.sessionChanged.push(payload);
        if (channel === "events:busyChanged") events.busyChanged.push(payload);
        if (channel === "events:error") events.errors.push(payload);
    };

    return {
        dir,
        configStore,
        sessionStore,
        session,
        runtime,
        events,
        llmCalls,
        llmCompleteCalls,
        toolRegistry,
    };
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

test("runSubAgent compacts local transcript and retries after context overflow", async () => {
    let chatCount = 0;
    const { session, runtime } = makeRuntimeHarness({
        chatImpl: () => {
            chatCount += 1;
            if (chatCount === 1) {
                const error = new Error("模型请求失败: 413 payload too large");
                error.status = 413;
                throw error;
            }
            return {
                message: {
                    id: "sub-assistant-2",
                    role: "assistant",
                    content: "sub-agent recovered",
                    createdAt: new Date().toISOString(),
                },
            };
        },
    });

    const messages = [];
    for (let i = 0; i < 6; i += 1) {
        messages.push({
            id: `sub-round-${i}`,
            role: i % 2 === 0 ? "user" : "assistant",
            content: `sub round ${i} ${"q".repeat(4000)}`,
            createdAt: new Date().toISOString(),
            ...(i % 2 === 1
                ? {
                      toolCalls: [
                          {
                              id: `call-${i}`,
                              function: { name: "read_file", arguments: "{}" },
                          },
                      ],
                  }
                : {}),
        });
        if (i % 2 === 1) {
            messages.push({
                id: `sub-tool-${i}`,
                role: "tool",
                name: "read_file",
                toolCallId: `call-${i}`,
                content: "file body ".repeat(2000),
                createdAt: new Date().toISOString(),
            });
        }
    }

    runtime.messagesForLLM = () => messages;

    const result = await runtime.runSubAgent({
        sessionId: session.meta.id,
        parentRunId: "parent-run",
        description: "heavy explore",
        prompt: "Inspect many files",
        subagentType: "explore",
    });

    assert.equal(chatCount, 2);
    assert.match(result, /sub-agent recovered/);
});

test("runSubAgent stops when local context remains blocked", async () => {
    const { session, runtime, configStore, llmCalls } = makeRuntimeHarness();
    const config = configStore.get();
    configStore.update({
        ...config,
        models: {
            ...config.models,
            openai: {
                ...config.models.openai,
                models: config.models.openai.models.map((model) =>
                    model.id === "gpt-4o-mini"
                        ? { ...model, contextWindow: 12_000 }
                        : model,
                ),
            },
        },
    });

    const result = await runtime.runSubAgent({
        sessionId: session.meta.id,
        parentRunId: "parent-run",
        description: "blocked explore",
        prompt: "z".repeat(120_000),
        subagentType: "explore",
    });

    assert.equal(llmCalls.length, 0);
    assert.match(result, /context limit reached/i);
    assert.match(result, /blocked explore/);
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

test("sendUserMessage drives TodoWrite from creation through auto-run to completion", async () => {
    let llmRound = 0;
    const { session, runtime, events, sessionStore, configStore } = makeRuntimeHarness({
        chatImpl: (args) => {
            llmRound += 1;
            if (llmRound >= 2) {
                const system = args.messages.find((message) => message.role === "system");
                assert.ok(system, "later rounds should inject active todos into system prompt");
                assert.match(system.content, /<active_todos>/);
                assert.match(system.content, /Step one/);
            }
            if (llmRound === 1) {
                return {
                    message: {
                        id: "assistant-todo-create",
                        role: "assistant",
                        content: "",
                        toolCalls: [
                            {
                                id: "call-create",
                                function: {
                                    name: "TodoWrite",
                                    arguments: JSON.stringify({
                                        merge: false,
                                        todos: [
                                            { id: "s1", content: "Step one", status: "pending" },
                                            { id: "s2", content: "Step two", status: "pending" },
                                        ],
                                    }),
                                },
                            },
                        ],
                        createdAt: new Date().toISOString(),
                    },
                };
            }
            if (llmRound === 2) {
                return {
                    message: {
                        id: "assistant-todo-start",
                        role: "assistant",
                        content: "",
                        toolCalls: [
                            {
                                id: "call-start",
                                function: {
                                    name: "TodoWrite",
                                    arguments: JSON.stringify({
                                        merge: true,
                                        todos: [
                                            { id: "s1", content: "Step one", status: "in_progress" },
                                        ],
                                    }),
                                },
                            },
                        ],
                        createdAt: new Date().toISOString(),
                    },
                };
            }
            if (llmRound === 3) {
                return {
                    message: {
                        id: "assistant-todo-progress",
                        role: "assistant",
                        content: "",
                        toolCalls: [
                            {
                                id: "call-progress",
                                function: {
                                    name: "TodoWrite",
                                    arguments: JSON.stringify({
                                        merge: true,
                                        todos: [
                                            { id: "s1", content: "Step one", status: "completed" },
                                            { id: "s2", content: "Step two", status: "in_progress" },
                                        ],
                                    }),
                                },
                            },
                        ],
                        createdAt: new Date().toISOString(),
                    },
                };
            }
            if (llmRound === 4) {
                return {
                    message: {
                        id: "assistant-todo-finish",
                        role: "assistant",
                        content: "",
                        toolCalls: [
                            {
                                id: "call-finish",
                                function: {
                                    name: "TodoWrite",
                                    arguments: JSON.stringify({
                                        merge: true,
                                        todos: [
                                            { id: "s2", content: "Step two", status: "completed" },
                                        ],
                                    }),
                                },
                            },
                        ],
                        createdAt: new Date().toISOString(),
                    },
                };
            }
            return {
                message: {
                    id: "assistant-done",
                    role: "assistant",
                    content: "All todos completed.",
                    createdAt: new Date().toISOString(),
                },
            };
        },
    });
    configStore.update({
        ...configStore.get(),
        agents: {
            ...configStore.get().agents,
            list: configStore.get().agents.list.map((agent, index) =>
                index === 0 ? { ...agent, max_tool_rounds: 6 } : agent,
            ),
        },
    });

    await runtime.sendUserMessage(session.meta.id, "请分步完成这两个任务");

    const updated = sessionStore.get(session.meta.id);
    const userMessage = updated.messages.find((message) => message.role === "user");
    assert.ok(userMessage);
    assert.equal(userMessage.content, "请分步完成这两个任务");
    const runId = userMessage.runId;
    assert.ok(runId);

    const todoRun = updated.meta.todoRuns[runId];
    assert.ok(todoRun);
    const byId = Object.fromEntries(todoRun.todos.map((todo) => [todo.id, todo]));
    assert.equal(byId.s1.status, "completed");
    assert.equal(byId.s2.status, "completed");
    assert.deepEqual(
        updated.meta.todos.map((todo) => todo.status),
        ["completed", "completed"],
    );

    assert.equal(runtime.busyBySession.get(session.meta.id), false);
    assert.equal(events.errors.length, 0);
    assert.ok(events.todosChanged.length >= 4);
    assert.ok(
        events.todosChanged.every((entry) => entry.sessionId === session.meta.id),
    );
    assert.ok(
        events.todosChanged.some(
            (entry) => entry.runId === runId && entry.todos.some((todo) => todo.status === "in_progress"),
        ),
    );

    const toolMessages = updated.messages.filter(
        (message) => message.role === "tool" && message.name === "TodoWrite",
    );
    assert.equal(toolMessages.length, 4);
    assert.match(toolMessages[0].content, /请立即开始执行上述 todos/);
    assert.match(toolMessages[0].content, /\[pending\] Step one/);
    assert.match(toolMessages[toolMessages.length - 1].content, /\[completed\] Step two/);

    const assistantMessages = updated.messages.filter((message) => message.role === "assistant");
    assert.match(assistantMessages[assistantMessages.length - 1].content, /All todos completed/);
    assert.equal(llmRound, 5);
});

test("runLoop auto-progresses todos across TodoWrite rounds", async () => {
    let llmRound = 0;
    const { session, runtime, events, sessionStore } = makeRuntimeHarness({
        chatImpl: () => {
            llmRound += 1;
            if (llmRound === 1) {
                return {
                    message: {
                        id: "assistant-todo-create",
                        role: "assistant",
                        content: "",
                        toolCalls: [
                            {
                                id: "call-create",
                                function: {
                                    name: "TodoWrite",
                                    arguments: JSON.stringify({
                                        merge: false,
                                        todos: [
                                            { id: "s1", content: "Step one", status: "pending" },
                                            { id: "s2", content: "Step two", status: "pending" },
                                        ],
                                    }),
                                },
                            },
                        ],
                        createdAt: new Date().toISOString(),
                    },
                };
            }
            if (llmRound === 2) {
                return {
                    message: {
                        id: "assistant-todo-progress",
                        role: "assistant",
                        content: "",
                        toolCalls: [
                            {
                                id: "call-progress",
                                function: {
                                    name: "TodoWrite",
                                    arguments: JSON.stringify({
                                        merge: true,
                                        todos: [
                                            { id: "s1", content: "Step one", status: "completed" },
                                            { id: "s2", content: "Step two", status: "in_progress" },
                                        ],
                                    }),
                                },
                            },
                        ],
                        createdAt: new Date().toISOString(),
                    },
                };
            }
            if (llmRound === 3) {
                return {
                    message: {
                        id: "assistant-todo-finish",
                        role: "assistant",
                        content: "",
                        toolCalls: [
                            {
                                id: "call-finish",
                                function: {
                                    name: "TodoWrite",
                                    arguments: JSON.stringify({
                                        merge: true,
                                        todos: [
                                            { id: "s2", content: "Step two", status: "completed" },
                                        ],
                                    }),
                                },
                            },
                        ],
                        createdAt: new Date().toISOString(),
                    },
                };
            }
            return {
                message: {
                    id: "assistant-done",
                    role: "assistant",
                    content: "All todos completed.",
                    createdAt: new Date().toISOString(),
                },
            };
        },
    });

    await runtime.runLoop(session, "run-todo-auto");

    const updated = sessionStore.get(session.meta.id);
    const byId = Object.fromEntries(updated.meta.todoRuns["run-todo-auto"].todos.map((t) => [t.id, t]));
    assert.equal(byId.s1.status, "completed");
    assert.equal(byId.s2.status, "completed");
    assert.ok(events.todosChanged.length >= 3);
    const toolMessages = updated.messages.filter((m) => m.role === "tool" && m.name === "TodoWrite");
    assert.equal(toolMessages.length, 3);
    assert.match(toolMessages[0].content, /请立即开始执行上述 todos/);
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

test("runLoop compacts and retries after context overflow error", async () => {
    let chatCount = 0;
    const { session, runtime, events, sessionStore } = makeRuntimeHarness({
        chatImpl: () => {
            chatCount += 1;
            if (chatCount === 1) {
                const error = new Error("模型请求失败: 413 payload too large");
                error.status = 413;
                throw error;
            }
            return {
                message: {
                    id: "assistant-recovered",
                    role: "assistant",
                    content: "recovered after compact",
                    createdAt: new Date().toISOString(),
                },
            };
        },
        completeImpl: () => ({
            message: {
                id: "assistant-summary",
                role: "assistant",
                content: "<summary>compressed history</summary>",
                createdAt: new Date().toISOString(),
            },
        }),
    });

    let working = session;
    for (let i = 0; i < 8; i += 1) {
        working = sessionStore.appendMessage(session.meta.id, {
            id: `ctx-${i}`,
            role: i % 2 === 0 ? "user" : "assistant",
            content: `round ${i} ${"y".repeat(5000)}`,
            createdAt: new Date().toISOString(),
        });
    }

    await runtime.runLoop(working, "run-413");

    assert.equal(chatCount, 2);
    const assistant = events.messageAppended.find(
        (entry) => entry.message.role === "assistant" && entry.message.content.includes("recovered"),
    )?.message;
    assert.ok(assistant);
    assert.match(assistant.content, /recovered after compact/);
});

test("runLoop stops with guidance when context remains blocked", async () => {
    const { session, runtime, events, sessionStore, configStore, llmCalls } = makeRuntimeHarness();
    const config = configStore.get();
    configStore.update({
        ...config,
        models: {
            ...config.models,
            openai: {
                ...config.models.openai,
                models: config.models.openai.models.map((model) =>
                    model.id === "gpt-4o-mini"
                        ? { ...model, contextWindow: 12_000 }
                        : model,
                ),
            },
        },
    });

    let working = session;
    for (let i = 0; i < 3; i += 1) {
        working = sessionStore.appendMessage(session.meta.id, {
            id: `bulk-${i}`,
            role: "user",
            content: "z".repeat(100_000),
            createdAt: new Date().toISOString(),
        });
    }

    await runtime.runLoop(working, "run-blocked");

    assert.equal(llmCalls.length, 0);
    const assistant = events.messageAppended.find(
        (entry) =>
            entry.message.role === "assistant" &&
            entry.message.content.includes("上下文已接近模型上限"),
    )?.message;
    assert.ok(assistant);
    assert.match(assistant.content, /compact_context/);
});

test("plan execution mode uses chat loop with read-only tool policy", async () => {
    const { session, runtime, configStore, llmCalls, llmCompleteCalls, events } = makeRuntimeHarness({
        chatImpl: () => ({
            message: {
                id: "assistant-plan",
                role: "assistant",
                content:
                    "计划已写入计划文件。\n1. 先定位入口\n2. 再拆解改动\n3. 最后验证\n\n请点击「开始执行」或切换到 Goal 模式。",
                createdAt: new Date().toISOString(),
            },
        }),
    });
    configStore.update({
        ...configStore.get(),
        agents: {
            ...configStore.get().agents,
            default: {
                ...configStore.get().agents.default,
                execution_mode: "plan",
            },
        },
    });

    await runtime.sendUserMessage(session.meta.id, "帮我改这个项目的会话标题策略");

    assert.equal(llmCompleteCalls.length, 0);
    assert.equal(llmCalls.length, 1);
    assert.equal(llmCalls[0].tools?.length ?? 0, 0);
    const assistant = events.messageAppended.find(
        (entry) => entry.message.role === "assistant",
    )?.message;
    assert.ok(assistant);
    assert.match(assistant.content, /计划/);
});

test("rejectPlanMode appends rejection user message and stays in plan", async () => {
    const { session, runtime, configStore, sessionStore } = makeRuntimeHarness({
        chatImpl: () => ({
            message: {
                id: "assistant-after-reject",
                role: "assistant",
                content: "已根据反馈更新计划。",
                createdAt: new Date().toISOString(),
            },
        }),
    });
    configStore.update({
        ...configStore.get(),
        agents: {
            ...configStore.get().agents,
            default: {
                ...configStore.get().agents.default,
                execution_mode: "plan",
            },
        },
    });
    await runtime.rejectPlanMode(session.meta.id, {
        planContent: "# Rejected plan\n\n- fix tests",
        feedback: "补充端到端验证步骤",
    });
    assert.equal(configStore.get().agents.default.execution_mode, "plan");
    const updated = sessionStore.get(session.meta.id);
    const rejection = updated.messages.find((m) => m.planRejection);
    assert.ok(rejection);
    assert.match(rejection.content, /rejected by the user/i);
    assert.match(rejection.content, /Rejected plan/);
    assert.match(rejection.content, /补充端到端验证步骤/);
});

test("exitPlanMode switches to goal and queues implementation prompt", async () => {
    const { session, runtime, configStore } = makeRuntimeHarness({
        chatImpl: () => ({
            message: {
                id: "assistant-plan",
                role: "assistant",
                content: "done planning",
                createdAt: new Date().toISOString(),
            },
        }),
    });
    configStore.update({
        ...configStore.get(),
        agents: {
            ...configStore.get().agents,
            default: {
                ...configStore.get().agents.default,
                execution_mode: "plan",
            },
        },
    });
    const result = await runtime.exitPlanMode(
        session.meta.id,
        "# Approved plan\n\n1. 实现用户登录功能\n2. 添加 API 接口",
    );
    assert.equal(result.config.agents.default.execution_mode, "goal");
    assert.equal(configStore.get().agents.default.execution_mode, "goal");
});

test("getSessionContextDetail exposes system prompt preview and full-session breakdown", () => {
    const { runtime, session, sessionStore } = makeRuntimeHarness();
    sessionStore.appendMessage(session.meta.id, {
        id: "user-1",
        role: "user",
        content: "hello",
        createdAt: new Date().toISOString(),
    });
    sessionStore.updateTodos(session.meta.id, [
        { id: "1", status: "pending", content: "ship feature" },
    ]);

    const detail = runtime.getSessionContextDetail(session.meta.id);

    assert.ok(detail.systemPromptText);
    assert.match(detail.systemPromptText, /active_todos/);
    assert.match(detail.systemPromptText, /ship feature/);
    const systemCategory = detail.categories.find((category) => category.id === "systemPrompt");
    assert.ok(systemCategory);
    assert.equal(systemCategory.previewText, detail.systemPromptText);
    assert.ok(systemCategory.tokens > 0);

    for (const category of detail.categories) {
        assert.ok(
            typeof category.previewText === "string" && category.previewText.length > 0,
            `${category.id} should include preview text`,
        );
    }

    const conversation = detail.categories.find((category) => category.id === "conversation");
    assert.ok(conversation);
    assert.match(conversation.previewText, /hello/);

    const categorizedTotal = detail.categories.reduce((sum, category) => sum + category.tokens, 0);
    assert.equal(categorizedTotal, detail.tokens);
});
