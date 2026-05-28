import { randomUUID } from "node:crypto";
import {
    CONTEXT_COMPACT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_ROLE,
    isContextDividerMessage,
} from "@shared/chatMessages";
import { IPC_CHANNELS } from "@shared/ipc";

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
                return `User: ${message.content}`;
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

    messagesForLLM(session) {
        const parts = [];
        const workspace = this.workspaceMemory.bootstrapSystemContent();
        if (workspace) {
            parts.push(workspace);
        }
        const agent = this.defaultAgent();
        if (agent?.tools?.enable_skills !== false) {
            parts.push(this.skillLoader.systemPromptSection());
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
        const fromIndex = Math.max(0, session.meta.llmContextFromIndex ?? 0);
        if (session.meta.contextSummary) {
            messages.push({
                id: randomUUID(),
                role: "user",
                content: `<conversation_summary>\n${session.meta.contextSummary}\n</conversation_summary>`,
                createdAt: new Date().toISOString(),
            });
        }
        messages.push(
            ...session.messages
                .slice(fromIndex)
                .filter((message) => !isContextDividerMessage(message)),
        );
        return messages;
    }

    async sendUserMessage(sessionId, rawInput) {
        const input = rawInput.trim();
        if (!input) {
            return;
        }
        if (this.busyBySession.get(sessionId)) {
            return;
        }

        if (input === "/clear") {
            this.clearLlmContext(sessionId);
            return;
        }
        if (input === "/compact") {
            await this.compactLlmContext(sessionId);
            return;
        }

        const userMessage = {
            id: randomUUID(),
            role: "user",
            content: input,
            createdAt: new Date().toISOString(),
        };
        let session = this.sessionStore.appendMessage(sessionId, userMessage);
        this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: userMessage });
        this.emit(IPC_CHANNELS.onSessionChanged, session);

        if (input === "/new") {
            return;
        }
        if (input === "/help") {
            const helpMessage = {
                id: randomUUID(),
                role: "assistant",
                content: [
                    "支持指令: /new /clear /help /compact",
                    "/clear — 保留聊天记录，插入上下文分界并仅重置模型上下文",
                    "/compact — 将较早对话压缩为摘要，保留最近几轮完整消息",
                    "",
                    "Workspace memory (`~/.CRAgent`):",
                    "- SOUL.md — identity & tone",
                    "- AGENTS.md — operating rules",
                    "- USER.md — about you",
                    "- MEMORY.md — long-term curated memory",
                    "- memory/YYYY-MM-DD.md — daily notes (today + yesterday loaded each turn)",
                    "",
                    "Skills: ~/.CRAgent/skills/ — use load_skill, download_skill, delete_skill",
                ].join("\n"),
                createdAt: new Date().toISOString(),
            };
            session = this.sessionStore.appendMessage(sessionId, helpMessage);
            this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: helpMessage });
            this.emit(IPC_CHANNELS.onSessionChanged, session);
            return;
        }
        await this.runLoop(session);
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

    async runLoop(session) {
        const sessionId = session.meta.id;
        this.setBusy(sessionId, true);
        try {
            const agent = this.defaultAgent();
            const maxRounds = Math.max(1, agent?.max_tool_rounds ?? 8);
            const toolsEnabled = agent?.tools?.enable_tools !== false;
            let round = 0;

            while (round < maxRounds) {
                session = this.sessionStore.get(sessionId);
                const choice = await this.llmClient.chat({
                    messages: this.messagesForLLM(session),
                    model: {
                        providerKey: session.meta.providerKey,
                        modelId: session.meta.modelId,
                    },
                    tools: toolsEnabled ? this.toolRegistry.schemas() : [],
                });
                const assistant = choice.message;
                session = this.sessionStore.appendMessage(session.meta.id, assistant);
                this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: assistant });
                this.emit(IPC_CHANNELS.onSessionChanged, session);

                const calls = assistant.toolCalls || [];
                if (!calls.length) {
                    return;
                }

                for (const call of calls) {
                    const result = await this.toolRegistry.execute(call);
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
