import { randomUUID } from "node:crypto";
import {
    CONTEXT_COMPACT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_ROLE,
    isContextDividerMessage,
} from "@shared/chatMessages";
import { IPC_CHANNELS } from "@shared/ipc";
import {
    appendAssistantMessage,
    createChatCommandHandlers,
} from "./tools/chatCommandHandlers.js";
import { formatTodosForPrompt, mergeTodos } from "./todoState.js";
import { filterToolsForSubAgent, subAgentSystemPrompt } from "./subAgentTypes.js";
import { parseModelRef } from "./modelFallback.js";

const COMPACT_KEEP_USER_TURNS = 2;
const COMPACT_MIN_CONTEXT_MESSAGES = 6;

const COMPACT_SUMMARIZE_SYSTEM = `You compress conversation history for context-window management.
Summarize the transcript concisely in the same language as the conversation.
Preserve: goals, decisions, file paths, code identifiers, errors, constraints, and unfinished tasks.
Do not invent facts. Output only the summary, no preamble.`;

function formatMessagesForSummary(messages) {
    return messages
        .map((message) => {
            if (message.role === "user") {
                const imageNote = message.images?.length
                    ? ` [${message.images.length} image(s)]`
                    : "";
                return `User: ${message.content || ""}${imageNote}`.trimEnd();
            }
            if (message.role === "assistant") {
                let line = `Assistant: ${message.content || ""}`.trimEnd();
                if (message.toolCalls?.length) {
                    const names = message.toolCalls
                        .map((call) => call.function?.name)
                        .filter(Boolean)
                        .join(", ");
                    if (names) {
                        line += `\n[tool_calls: ${names}]`;
                    }
                }
                return line;
            }
            if (message.role === "tool") {
                const body = String(message.content || "").slice(0, 800);
                return `Tool (${message.name || "tool"}): ${body}`;
            }
            return "";
        })
        .filter(Boolean)
        .join("\n\n");
}

function splitMessagesForCompact(messages) {
    if (messages.length < COMPACT_MIN_CONTEXT_MESSAGES) {
        return { toSummarize: [], keep: messages };
    }
    const keep = [];
    let userTurns = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        keep.unshift(messages[index]);
        if (messages[index].role === "user") {
            userTurns += 1;
            if (userTurns >= COMPACT_KEEP_USER_TURNS) {
                break;
            }
        }
    }
    const keepCount = keep.length;
    if (keepCount >= messages.length) {
        return { toSummarize: [], keep: messages };
    }
    return {
        toSummarize: messages.slice(0, messages.length - keepCount),
        keep,
    };
}

function getActiveContextEntries(session) {
    const fromIndex = Math.max(0, session.meta.llmContextFromIndex ?? 0);
    const entries = [];
    for (let index = fromIndex; index < session.messages.length; index += 1) {
        const message = session.messages[index];
        if (!isContextDividerMessage(message)) {
            entries.push({ message, index });
        }
    }
    return entries;
}

export class AgentRuntime {
    constructor(sessionStore, configStore, llmClient, toolRegistry, workspaceMemory, skillLoader, mainWindowGetter) {
        this.sessionStore = sessionStore;
        this.configStore = configStore;
        this.llmClient = llmClient;
        this.toolRegistry = toolRegistry;
        this.workspaceMemory = workspaceMemory;
        this.skillLoader = skillLoader;
        this.mainWindowGetter = mainWindowGetter;
        this.busyBySession = new Map();
        this.chatCommands = createChatCommandHandlers({
            sessionStore: this.sessionStore,
            emit: (channel, payload) => this.emit(channel, payload),
            clearLlmContext: (sessionId) => this.clearLlmContext(sessionId),
            compactLlmContext: (sessionId) => this.compactLlmContext(sessionId),
            appendHelpMessage: (sessionId, content, runId) =>
                appendAssistantMessage(
                    this.sessionStore,
                    (channel, payload) => this.emit(channel, payload),
                    sessionId,
                    content,
                    runId ? { runId } : {},
                ),
        });
    }

    emit(channel, payload) {
        this.mainWindowGetter()?.webContents.send(channel, payload);
    }

    setBusy(sessionId, busy) {
        this.busyBySession.set(sessionId, busy);
        this.emit(IPC_CHANNELS.onBusyChanged, { sessionId, busy });
    }

    defaultAgent() {
        return (
            this.configStore.get().agents.list.find((agent) => agent.is_default) ||
            this.configStore.get().agents.list[0]
        );
    }

    messagesForLLM(session, options = {}) {
        const {
            subAgentPrompt = null,
            subagentType = "generalPurpose",
            includeSessionHistory = true,
        } = options;
        const parts = [];
        if (subAgentPrompt) {
            parts.push(subAgentSystemPrompt(subagentType));
        }
        const workspace = this.workspaceMemory.bootstrapSystemContent();
        if (workspace) {
            parts.push(workspace);
        }
        const agent = this.defaultAgent();
        if (agent?.tools?.enable_skills !== false) {
            parts.push(this.skillLoader.systemPromptSection());
        }
        const todoPrompt = formatTodosForPrompt(session.meta.todos);
        if (todoPrompt) {
            parts.push(todoPrompt);
        }
        const messages = [];
        if (parts.length) {
            messages.push({
                id: randomUUID(),
                role: "system",
                content: parts.join("\n\n"),
                createdAt: new Date().toISOString(),
            });
        }
        if (subAgentPrompt) {
            messages.push({
                id: randomUUID(),
                role: "user",
                content: subAgentPrompt,
                createdAt: new Date().toISOString(),
            });
            return messages;
        }
        const fromIndex = Math.max(0, session.meta.llmContextFromIndex ?? 0);
        if (session.meta.contextSummary) {
            messages.push({
                id: randomUUID(),
                role: "user",
                content: `<conversation_summary>\n${session.meta.contextSummary}\n</conversation_summary>`,
                createdAt: new Date().toISOString(),
            });
        }
        if (includeSessionHistory) {
            messages.push(
                ...session.messages
                    .slice(fromIndex)
                    .filter((message) => !isContextDividerMessage(message)),
            );
        }
        return messages;
    }

    modelChainForSession(session) {
        return this.configStore.resolveModelChain(
            session.meta.providerKey,
            session.meta.modelId,
        );
    }

    updateTodos(sessionId, incoming, merge) {
        const session = this.sessionStore.get(sessionId);
        const next = mergeTodos(session.meta.todos || [], incoming, merge);
        const updated = this.sessionStore.updateTodos(sessionId, next);
        this.emit(IPC_CHANNELS.onTodosChanged, { sessionId, todos: next });
        this.emit(IPC_CHANNELS.onSessionChanged, updated);
        return next;
    }

    async runSubAgent({
        sessionId,
        parentRunId,
        description,
        prompt,
        subagentType = "generalPurpose",
        modelOverride = null,
    }) {
        const session = this.sessionStore.get(sessionId);
        const override = modelOverride ? parseModelRef(modelOverride) : null;
        const model = override || {
            providerKey: session.meta.providerKey,
            modelId: session.meta.modelId,
        };
        const modelChain = override
            ? [model]
            : this.modelChainForSession(session);
        const agent = this.defaultAgent();
        const toolsEnabled = agent?.tools?.enable_tools !== false;
        const allTools = this.toolRegistry.allTools();
        const subTools = filterToolsForSubAgent(allTools, subagentType).filter((tool) =>
            tool.enabled(),
        );
        const schemas = subTools
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((tool) => tool.schema);
        const subRunId = randomUUID();
        const messages = this.messagesForLLM(session, {
            subAgentPrompt: prompt,
            subagentType,
            includeSessionHistory: false,
        });
        const maxRounds = Math.max(1, agent?.max_tool_rounds ?? 8);
        let round = 0;

        while (round < maxRounds) {
            const choice = await this.llmClient.chat({
                messages,
                model,
                modelChain,
                tools: toolsEnabled ? schemas : [],
            });
            const assistant = choice.message;
            const calls = assistant.toolCalls || [];
            if (!calls.length) {
                const body = String(assistant.content || "").trim() || "(no output)";
                const fallbackNote = choice.usedFallback
                    ? `\n\n[sub-agent used fallback model ${choice.usedModel.providerKey}/${choice.usedModel.modelId}]`
                    : "";
                return `Sub-agent "${description}" completed:\n\n${body}${fallbackNote}`;
            }

            messages.push(assistant);
            for (const call of calls) {
                if (call.function.name === "Task") {
                    messages.push({
                        id: randomUUID(),
                        role: "tool",
                        name: call.function.name,
                        toolCallId: call.id,
                        content: "Error: sub-agents cannot spawn additional sub-agents",
                        createdAt: new Date().toISOString(),
                        runId: subRunId,
                    });
                    continue;
                }
                const result = await this.toolRegistry.execute(call, {
                    sessionId,
                    runId: subRunId,
                    parentRunId,
                    isSubAgent: true,
                });
                if (
                    call.function.name === "download_skill" ||
                    call.function.name === "delete_skill"
                ) {
                    this.skillLoader.reload();
                }
                messages.push({
                    id: randomUUID(),
                    role: "tool",
                    name: call.function.name,
                    toolCallId: call.id,
                    content: result,
                    createdAt: new Date().toISOString(),
                    runId: subRunId,
                });
            }
            round += 1;
        }

        return `Sub-agent "${description}" reached tool round limit before finishing.`;
    }

    async sendUserMessage(sessionId, rawInput, images = []) {
        const input = rawInput.trim();
        const storedImages = Array.isArray(images)
            ? images
                  .filter((image) => image?.dataUrl && image?.mimeType)
                  .map((image) => ({
                      mimeType: image.mimeType,
                      dataUrl: image.dataUrl,
                  }))
            : [];
        if (!input && !storedImages.length) {
            return;
        }
        if (this.busyBySession.get(sessionId)) {
            return;
        }

        const commandId = this.chatCommands.match(input);
        if (commandId) {
            let helpRunId;
            if (commandId === "help") {
                helpRunId = randomUUID();
                const userMessage = {
                    id: randomUUID(),
                    role: "user",
                    content: input,
                    createdAt: new Date().toISOString(),
                    runId: helpRunId,
                };
                let session = this.sessionStore.appendMessage(sessionId, userMessage);
                this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: userMessage });
                this.emit(IPC_CHANNELS.onSessionChanged, session);
            }
            await this.chatCommands.execute(commandId, sessionId, helpRunId);
            return;
        }

        const runId = randomUUID();
        const userMessage = {
            id: randomUUID(),
            role: "user",
            content: input,
            createdAt: new Date().toISOString(),
            runId,
            ...(storedImages.length ? { images: storedImages } : {}),
        };
        let session = this.sessionStore.appendMessage(sessionId, userMessage);
        this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: userMessage });
        this.emit(IPC_CHANNELS.onSessionChanged, session);

        await this.runLoop(session, runId);
    }

    clearLlmContext(sessionId) {
        const dividerMessage = {
            id: randomUUID(),
            role: CONTEXT_DIVIDER_ROLE,
            content: CONTEXT_DIVIDER_LABEL,
            createdAt: new Date().toISOString(),
        };
        let session = this.sessionStore.appendMessage(sessionId, dividerMessage);
        session.meta.llmContextFromIndex = session.messages.length;
        delete session.meta.contextSummary;
        this.sessionStore.save(session);
        this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: dividerMessage });
        this.emit(IPC_CHANNELS.onSessionChanged, session);
    }

    async compactLlmContext(sessionId) {
        this.setBusy(sessionId, true);
        try {
            let session = this.sessionStore.get(sessionId);
            const entries = getActiveContextEntries(session);
            const activeMessages = entries.map((entry) => entry.message);
            const { toSummarize, keep } = splitMessagesForCompact(activeMessages);

            if (!toSummarize.length) {
                const notice = {
                    id: randomUUID(),
                    role: "assistant",
                    content: "当前上下文过短，暂无需压缩。",
                    createdAt: new Date().toISOString(),
                };
                session = this.sessionStore.appendMessage(sessionId, notice);
                this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: notice });
                this.emit(IPC_CHANNELS.onSessionChanged, session);
                return;
            }

            const transcriptParts = [];
            if (session.meta.contextSummary) {
                transcriptParts.push(
                    `Previous summary:\n${session.meta.contextSummary}`,
                );
            }
            transcriptParts.push(formatMessagesForSummary(toSummarize));
            const transcript = transcriptParts.join("\n\n---\n\n");

            const choice = await this.llmClient.complete({
                model: {
                    providerKey: session.meta.providerKey,
                    modelId: session.meta.modelId,
                },
                modelChain: this.modelChainForSession(session),
                messages: [
                    { role: "system", content: COMPACT_SUMMARIZE_SYSTEM },
                    { role: "user", content: transcript },
                ],
            });
            const summary = String(choice.message.content || "").trim();
            if (!summary) {
                this.emit(IPC_CHANNELS.onError, {
                    sessionId,
                    message: "压缩失败：模型未返回有效摘要。",
                });
                return;
            }

            const keepStartIndex = entries[entries.length - keep.length].index;
            const dividerMessage = {
                id: randomUUID(),
                role: CONTEXT_DIVIDER_ROLE,
                content: CONTEXT_COMPACT_DIVIDER_LABEL,
                createdAt: new Date().toISOString(),
            };
            session = this.sessionStore.get(sessionId);
            session.messages.splice(keepStartIndex, 0, dividerMessage);
            session.meta.llmContextFromIndex = keepStartIndex + 1;
            session.meta.contextSummary = summary;
            session.meta.updatedAt = new Date().toISOString();
            this.sessionStore.save(session);
            this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: dividerMessage });
            this.emit(IPC_CHANNELS.onSessionChanged, session);

            const feedback = {
                id: randomUUID(),
                role: "assistant",
                content: `已压缩 ${toSummarize.length} 条较早消息为摘要，保留最近 ${keep.length} 条消息完整上下文。`,
                createdAt: new Date().toISOString(),
            };
            session = this.sessionStore.appendMessage(sessionId, feedback);
            this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: feedback });
            this.emit(IPC_CHANNELS.onSessionChanged, session);
        } catch (error) {
            this.emit(IPC_CHANNELS.onError, {
                sessionId,
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.setBusy(sessionId, false);
        }
    }

    async runLoop(session, runId) {
        const sessionId = session.meta.id;
        this.setBusy(sessionId, true);
        try {
            const agent = this.defaultAgent();
            const maxRounds = Math.max(1, agent?.max_tool_rounds ?? 8);
            const toolsEnabled = agent?.tools?.enable_tools !== false;
            let round = 0;

            while (round < maxRounds) {
                session = this.sessionStore.get(sessionId);
                const model = {
                    providerKey: session.meta.providerKey,
                    modelId: session.meta.modelId,
                };
                const choice = await this.llmClient.chat({
                    messages: this.messagesForLLM(session),
                    model,
                    modelChain: this.modelChainForSession(session),
                    tools: toolsEnabled ? this.toolRegistry.schemas() : [],
                });
                const assistant = { ...choice.message, runId };
                if (choice.usedFallback && choice.usedModel) {
                    const note = `(已自动切换至备用模型 ${choice.usedModel.providerKey}/${choice.usedModel.modelId})\n\n`;
                    assistant.content = `${note}${assistant.content || ""}`;
                }
                session = this.sessionStore.appendMessage(session.meta.id, assistant);
                this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: assistant });
                this.emit(IPC_CHANNELS.onSessionChanged, session);

                const calls = assistant.toolCalls || [];
                if (!calls.length) {
                    return;
                }

                for (const call of calls) {
                    const result = await this.toolRegistry.execute(call, {
                        sessionId,
                        runId,
                    });
                    if (
                        call.function.name === "download_skill" ||
                        call.function.name === "delete_skill"
                    ) {
                        this.skillLoader.reload();
                    }
                    const toolMessage = {
                        id: randomUUID(),
                        role: "tool",
                        name: call.function.name,
                        toolCallId: call.id,
                        content: result,
                        createdAt: new Date().toISOString(),
                        runId,
                    };
                    session = this.sessionStore.appendMessage(sessionId, toolMessage);
                    this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: toolMessage });
                    this.emit(IPC_CHANNELS.onSessionChanged, session);
                }
                round += 1;
            }

            const limitMessage = {
                id: randomUUID(),
                role: "assistant",
                content: "已达到工具调用上限，请回复继续。",
                createdAt: new Date().toISOString(),
                runId,
            };
            session = this.sessionStore.appendMessage(sessionId, limitMessage);
            this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: limitMessage });
            this.emit(IPC_CHANNELS.onSessionChanged, session);
        } catch (error) {
            this.emit(IPC_CHANNELS.onError, {
                sessionId,
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.setBusy(sessionId, false);
        }
    }
}
