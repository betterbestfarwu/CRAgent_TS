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
import { mergeUiConfig } from "../src/shared/uiConfig.js";

function makeTempConfig(dir, uiPatch = {}) {
    const configFile = path.join(dir, "config.json");
    const store = new ConfigStore(configFile);
    store.update({
        ...store.get(),
        ui: mergeUiConfig(uiPatch),
        agents: {
            ...store.get().agents,
            default: {
                ...store.get().agents.default,
                model: { primary: "openai/gpt-4o-mini", fallbacks: [] },
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
                        allow_sub_agents: false,
                    },
                },
            ],
        },
        models: {
            openai: {
                baseUrl: "https://api.example.com/v1",
                apiKey: "sk-test",
                api: "chat/completions",
                state: true,
                models: [{ id: "gpt-4o-mini", name: "gpt-4o-mini", state: true }],
            },
        },
    });
    return store;
}

function writeProjectHooks(projectRoot, hooksBody) {
    fs.mkdirSync(path.join(projectRoot, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "hooks.json"), JSON.stringify(hooksBody, null, 2));
}

function makeHarnessWithHooks(projectRoot, options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-hooks-int-"));
    const configStore = makeTempConfig(dir, options.uiPatch);
    const sessionsDir = path.join(dir, "sessions");
    const projectsFile = path.join(dir, "projects.json");
    fs.mkdirSync(sessionsDir, { recursive: true });

    const sessionStore = new SessionStore(sessionsDir, configStore.resolvePrimaryRef(), projectsFile);
    const project = sessionStore.addProject(projectRoot);
    const session = sessionStore.newSession({ projectId: project.id });

    const readCalls = [];
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
                    content: "done",
                    createdAt: new Date().toISOString(),
                },
            };
        },
        complete: async () => ({
            message: {
                id: "assistant-c",
                role: "assistant",
                content: "summary",
                createdAt: new Date().toISOString(),
            },
        }),
    };

    const runtime = new AgentRuntime(
        sessionStore,
        configStore,
        llmClient,
        new ToolRegistry(() => [
            ...createMetaTools({
                getAgentTools: () => configStore.get().agents.list[0].tools,
                updateTodos: (sid, todos, merge, runId) =>
                    runtime.updateTodos(sid, todos, merge, runId),
                runSubAgent: (args) => runtime.runSubAgent(args),
                runSubAgentInBackground: (args) => runtime.runSubAgentInBackground(args),
                readSubAgentOutput: (args) => runtime.readSubAgentOutput(args),
            }),
            {
                name: "read_file",
                requiresConfirmation: false,
                enabled: () => true,
                schema: {
                    type: "function",
                    function: {
                        name: "read_file",
                        description: "read",
                        parameters: {
                            type: "object",
                            properties: { path: { type: "string" } },
                            required: ["path"],
                        },
                    },
                },
                async execute(args) {
                    readCalls.push(args);
                    return `file:${args.path}`;
                },
            },
        ]),
        { bootstrapSystemContent: () => "" },
        { systemPromptSection: () => "", reload: () => {} },
        () => null,
    );

    runtime.emit = () => {};

    return {
        dir,
        configStore,
        sessionStore,
        session,
        runtime,
        project,
        readCalls,
        llmCalls,
    };
}

test("UserPromptSubmit hook blocks message before LLM", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-hook-block-"));
    writeProjectHooks(projectRoot, {
        version: 1,
        hooks: {
            UserPromptSubmit: [{ command: "hooks/block-prompt.sh" }],
        },
    });
    fs.writeFileSync(
        path.join(projectRoot, "hooks", "block-prompt.sh"),
        `#!/bin/bash
input=$(cat)
if echo "$input" | grep -q 'BLOCK_ME'; then
  echo '{"decision":"block","reason":"blocked by integration test"}' >&2
  exit 2
fi
echo '{}'
`,
        { mode: 0o755 },
    );

    const { session, runtime, sessionStore, llmCalls } = makeHarnessWithHooks(projectRoot);
    await runtime.dispatchUserMessage(session.meta.id, "please BLOCK_ME now");

    assert.equal(llmCalls.length, 0);
    const updated = sessionStore.get(session.meta.id);
    const assistant = updated.messages.find((m) => m.role === "assistant");
    assert.ok(assistant);
    assert.match(assistant.content, /blocked by integration test/i);

    const logs = runtime.getHookLogs(session.meta.id);
    assert.ok(logs.some((row) => row.event === "UserPromptSubmit" && row.status === "blocked"));
});

test("PreToolUse hook rewrites tool input before execution", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-hook-rewrite-"));
    writeProjectHooks(projectRoot, {
        version: 1,
        hooks: {
            PreToolUse: [{ command: "hooks/rewrite-read.sh", matcher: "read_file" }],
        },
    });
    fs.writeFileSync(
        path.join(projectRoot, "hooks", "rewrite-read.sh"),
        `#!/bin/bash
echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"path":"from-hook.txt"}}}'
`,
        { mode: 0o755 },
    );

    const { session, runtime, readCalls } = makeHarnessWithHooks(projectRoot, {
        chatImpl: (_args, callIndex) => {
            if (callIndex === 1) {
                return {
                    message: {
                        id: "a-tool",
                        role: "assistant",
                        content: "",
                        toolCalls: [
                            {
                                id: "call-read",
                                type: "function",
                                function: {
                                    name: "read_file",
                                    arguments: JSON.stringify({ path: "original.txt" }),
                                },
                            },
                        ],
                        createdAt: new Date().toISOString(),
                    },
                };
            }
            return {
                message: {
                    id: "a-done",
                    role: "assistant",
                    content: "finished",
                    createdAt: new Date().toISOString(),
                },
            };
        },
    });

    await runtime.dispatchUserMessage(session.meta.id, "read a file");

    assert.equal(readCalls.length, 1);
    assert.equal(readCalls[0].path, "from-hook.txt");

    const logs = runtime.getHookLogs(session.meta.id);
    assert.ok(logs.some((row) => row.event === "PreToolUse" && row.status === "success"));
});

test("hooks_enabled=false skips project hooks", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-hook-off-"));
    writeProjectHooks(projectRoot, {
        version: 1,
        hooks: {
            UserPromptSubmit: [{ command: "hooks/block-prompt.sh" }],
        },
    });
    fs.writeFileSync(
        path.join(projectRoot, "hooks", "block-prompt.sh"),
        `#!/bin/bash
echo '{"decision":"block","reason":"should not run"}' >&2
exit 2
`,
        { mode: 0o755 },
    );

    const { session, runtime, llmCalls } = makeHarnessWithHooks(projectRoot, {
        uiPatch: { hooks_enabled: false },
    });
    await runtime.dispatchUserMessage(session.meta.id, "BLOCK_ME anyway");

    assert.equal(llmCalls.length, 1);
    assert.equal(runtime.getHookLogs(session.meta.id).length, 0);
});
