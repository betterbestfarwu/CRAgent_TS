import { randomUUID } from "node:crypto";
import { IPC_CHANNELS } from "@shared/ipc";

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
        messages.push(...session.messages);
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
        if (input === "/clear") {
            session.messages = [];
            this.sessionStore.save(session);
            this.emit(IPC_CHANNELS.onSessionChanged, session);
            return;
        }

        await this.runLoop(session);
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
