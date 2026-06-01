import { randomUUID } from "node:crypto";
import {
    CONTEXT_COMPACT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_ROLE,
    isContextDividerMessage,
    withAssistantModel,
} from "@shared/chatMessages";
import { IPC_CHANNELS } from "@shared/ipc";
import { expandAtMentionsToAbsolute } from "./atMentionExpand.js";
import { normalizeAtMentions } from "@shared/atMention.js";
import {
    appendAssistantMessage,
    createChatCommandHandlers,
} from "./tools/chatCommandHandlers.js";
import { formatTodosForPrompt, mergeTodos } from "./todoState.js";
import { filterToolsForSubAgent, subAgentSystemPrompt } from "./subAgentTypes.js";
import { isContextOverflowError, parseModelRef } from "./modelFallback.js";

const MAX_CONTEXT_OVERFLOW_RETRIES = 2;
import {
    buildCompactTranscript,
    buildPostCompactContext,
    calculateContextWarningState,
    calculateMessagesContextWarningState,
    COMPACT_SUMMARIZE_SYSTEM,
    shrinkSubAgentMessages,
    formatCompactSummary,
    getContextConfig,
    microCompactMessages,
    parseReadFileResult,
    preCompactMicroCompact,
    shouldAutoCompact,
    splitMessagesForCompact,
    trackLoadedSkill,
    trackReadFile,
    trySessionMemoryCompact,
} from "./contextCompression.js";
import {
    buildSessionMemoryTranscript,
    clearSessionMemory,
    formatSessionMemory,
    getPendingMemoryMessages,
    SESSION_MEMORY_UPDATE_SYSTEM,
    shouldRefreshSessionMemory,
    syncSessionMemoryAfterCompact,
} from "./sessionMemory.js";
import { resolveSessionWorkspace, resolveWorkspace } from "./workspacePaths.js";

const PLAN_MODE_SYSTEM_PROMPT = [
    "You are in Plan Mode.",
    "Do not call tools or claim actions were executed.",
    "Return a concise implementation plan only:",
    "1) understanding, 2) steps, 3) risks/checks, 4) explicit handoff asking user to switch to Goal Mode for execution.",
].join("\n");

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
        this.compactingSessions = new Set();
        this.pendingQueues = new Map();
        this.abortControllers = new Map();
        this.cancelledRuns = new Set();
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

    executionMode() {
        const mode = this.configStore.get().agents?.default?.execution_mode;
        return mode === "plan" ? "plan" : "goal";
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
        const sessionWorkspace = resolveSessionWorkspace(
            this.sessionStore,
            this.configStore,
            session.meta.id,
        );
        const defaultWorkspace = resolveWorkspace(this.configStore);
        if (sessionWorkspace !== defaultWorkspace) {
            parts.push(
                `<session_workspace path="${sessionWorkspace}">\n` +
                    "This session belongs to a project. File tools and shell commands use this directory as the working directory.\n" +
                    "</session_workspace>",
            );
        }
        const workspace = this.workspaceMemory.bootstrapSystemContent();
        if (workspace) {
            parts.push(workspace);
        }
        const agent = this.defaultAgent();
        if (agent?.tools?.enable_skills !== false) {
            parts.push(this.skillLoader.systemPromptSection());
        }
        if (this.executionMode() === "plan") {
            parts.push(PLAN_MODE_SYSTEM_PROMPT);
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
        if (session.meta.postCompactContext) {
            messages.push({
                id: randomUUID(),
                role: "user",
                content: session.meta.postCompactContext,
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

    updateTodos(sessionId, incoming, merge, runId) {
        const session = this.sessionStore.get(sessionId);
        const existingRun =
            runId && session.meta.todoRuns?.[runId]?.todos
                ? session.meta.todoRuns[runId].todos
                : session.meta.todos || [];
        const next = mergeTodos(existingRun, incoming, merge);
        const updated = runId
            ? this.sessionStore.updateTodoRun(sessionId, runId, next)
            : this.sessionStore.updateTodos(sessionId, next);
        this.emit(IPC_CHANNELS.onTodosChanged, {
            sessionId,
            runId: runId || null,
            todos: next,
            todoRuns: updated.meta.todoRuns || {},
        });
        this.emit(IPC_CHANNELS.onSessionChanged, updated);
        return next;
    }

    parseSkillInvocation(input) {
        const match = String(input || "")
            .trim()
            .match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/);
        if (!match) {
            return null;
        }
        const skillName = match[1];
        const rest = (match[2] || "").trim();
        const loaded = this.skillLoader.loadFullText(skillName);
        if (loaded.startsWith("Error:")) {
            return null;
        }
        return { skillName, rest, loaded };
    }

    enqueueMessage(sessionId, rawInput, images = [], atMentions = [], userText = null) {
        const queue = this.pendingQueues.get(sessionId) || [];
        queue.push({
            id: randomUUID(),
            input: rawInput,
            images,
            atMentions: normalizeAtMentions(atMentions),
            userText,
            createdAt: new Date().toISOString(),
        });
        this.pendingQueues.set(sessionId, queue);
        this.emit(IPC_CHANNELS.onQueueChanged, { sessionId, queue: [...queue] });
    }

    dequeueNextMessage(sessionId) {
        const queue = this.pendingQueues.get(sessionId) || [];
        if (!queue.length) {
            return null;
        }
        const next = queue.shift();
        this.pendingQueues.set(sessionId, queue);
        this.emit(IPC_CHANNELS.onQueueChanged, { sessionId, queue: [...queue] });
        return next;
    }

    removeQueuedMessage(sessionId, messageId) {
        const queue = (this.pendingQueues.get(sessionId) || []).filter(
            (item) => item.id !== messageId,
        );
        this.pendingQueues.set(sessionId, queue);
        this.emit(IPC_CHANNELS.onQueueChanged, { sessionId, queue: [...queue] });
    }

    cancelRun(sessionId) {
        this.cancelledRuns.add(sessionId);
        this.abortControllers.get(sessionId)?.abort();
        this.pendingQueues.set(sessionId, []);
        this.emit(IPC_CHANNELS.onQueueChanged, { sessionId, queue: [] });
    }

    async processQueue(sessionId) {
        if (this.busyBySession.get(sessionId)) {
            return;
        }
        const next = this.dequeueNextMessage(sessionId);
        if (!next) {
            return;
        }
        await this.dispatchUserMessage(sessionId, next.input, next.images, next.atMentions, next.userText);
    }

    createAbortSignal(sessionId) {
        const controller = new AbortController();
        this.abortControllers.set(sessionId, controller);
        return controller.signal;
    }

    clearAbortSignal(sessionId) {
        this.abortControllers.delete(sessionId);
    }

    wasRunCancelled(sessionId) {
        if (!this.cancelledRuns.has(sessionId)) {
            return false;
        }
        this.cancelledRuns.delete(sessionId);
        return true;
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
        const providerKey = override?.providerKey ?? session.meta.providerKey;
        const modelId = override?.modelId ?? session.meta.modelId;
        const model = this.configStore.model(providerKey, modelId) || {
            providerKey,
            modelId,
        };
        const modelChain = override
            ? [{ providerKey, modelId }]
            : this.modelChainForSession(session);
        const agent = this.defaultAgent();
        const toolsEnabled = agent?.tools?.enable_tools !== false;
        const allTools = this.toolRegistry.allTools();
        const subTools = filterToolsForSubAgent(allTools, subagentType).filter((tool) =>
            tool.enabled(),
        );
        const unlockedToolNames = new Set();
        const subRunId = randomUUID();
        const messages = this.messagesForLLM(session, {
            subAgentPrompt: prompt,
            subagentType,
            includeSessionHistory: false,
        });
        const maxRounds = Math.max(1, agent?.max_tool_rounds ?? 8);
        let round = 0;

        while (round < maxRounds) {
            const chatResult = await this.requestSubAgentLlm(sessionId, messages, model, () =>
                this.llmClient.chat({
                    messages,
                    model,
                    modelChain,
                    tools: toolsEnabled
                        ? this.toolRegistry.schemas({
                              tools: subTools,
                              unlockedToolNames,
                          })
                        : [],
                }),
            );
            if (chatResult.blocked) {
                return this.subAgentBlockedMessage(description, chatResult.state);
            }
            const choice = chatResult.choice;
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
                    unlockedToolNames,
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

    async sendUserMessage(sessionId, rawInput, images = [], atMentions = [], userText = null) {
        const input = rawInput.trim();
        const normalizedMentions = normalizeAtMentions(atMentions);
        const storedImages = Array.isArray(images)
            ? images
                  .filter((image) => image?.dataUrl && image?.mimeType)
                  .map((image) => ({
                      mimeType: image.mimeType,
                      dataUrl: image.dataUrl,
                  }))
            : [];
        if (!input && !storedImages.length && !normalizedMentions.length) {
            return;
        }
        if (this.busyBySession.get(sessionId)) {
            this.enqueueMessage(sessionId, rawInput, storedImages, normalizedMentions, userText);
            return { queued: true };
        }
        await this.dispatchUserMessage(sessionId, rawInput, storedImages, normalizedMentions, userText);
    }

    async dispatchUserMessage(sessionId, rawInput, storedImages = [], atMentions = [], userText = null) {
        const normalizedMentions = normalizeAtMentions(atMentions);
        const input = rawInput.trim();
        const displayText = userText != null ? String(userText).trim() : input;
        if (!input && !storedImages.length) {
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
            await this.processQueue(sessionId);
            return;
        }

        const skillInvoke = this.parseSkillInvocation(input);
        const runId = randomUUID();
        const projectRoot = this.sessionStore.getProjectDirectory(sessionId);
        let messageContent = expandAtMentionsToAbsolute(input, projectRoot);
        if (skillInvoke) {
            messageContent = skillInvoke.rest
                ? expandAtMentionsToAbsolute(skillInvoke.rest, projectRoot)
                : `请按照已加载的 skill「${skillInvoke.skillName}」执行任务。`;
        }

        const userMessage = {
            id: randomUUID(),
            role: "user",
            content: messageContent,
            createdAt: new Date().toISOString(),
            runId,
            ...(normalizedMentions.length
                ? { atMentions: normalizedMentions, userText: displayText }
                : {}),
            ...(skillInvoke
                ? { skillName: skillInvoke.skillName, skillLoaded: true }
                : {}),
            ...(storedImages.length ? { images: storedImages } : {}),
        };
        let session = this.sessionStore.appendMessage(sessionId, userMessage);
        if (skillInvoke) {
            session = this.trackToolSideEffects(
                session,
                {
                    function: {
                        name: "load_skill",
                        arguments: JSON.stringify({ name: skillInvoke.skillName }),
                    },
                },
                skillInvoke.loaded,
            );
            this.sessionStore.save(session);
        }
        this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: userMessage });
        this.emit(IPC_CHANNELS.onSessionChanged, session);

        if (this.executionMode() === "plan") {
            await this.runPlanLoop(session, runId);
            await this.processQueue(sessionId);
            return;
        }

        await this.runLoop(session, runId);
        await this.processQueue(sessionId);
    }

    async runPlanLoop(session, runId) {
        const sessionId = session.meta.id;
        this.setBusy(sessionId, true);
        const signal = this.createAbortSignal(sessionId);
        try {
            if (this.wasRunCancelled(sessionId)) {
                return;
            }
            session = this.sessionStore.get(sessionId);
            const model = {
                providerKey: session.meta.providerKey,
                modelId: session.meta.modelId,
            };
            const llmResult = await this.requestAgentLlm(sessionId, () =>
                this.llmClient.complete({
                    messages: this.messagesForLLM(session),
                    model,
                    modelChain: this.modelChainForSession(session),
                    signal,
                }),
            );
            if (this.wasRunCancelled(sessionId)) {
                return;
            }
            if (llmResult.blocked) {
                const blockedMessage = withAssistantModel(
                    {
                        id: randomUUID(),
                        role: "assistant",
                        content: this.contextBlockedMessage(llmResult.state),
                        createdAt: new Date().toISOString(),
                        runId,
                    },
                    model,
                );
                session = this.sessionStore.appendMessage(session.meta.id, blockedMessage);
                this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: blockedMessage });
                this.emit(IPC_CHANNELS.onSessionChanged, session);
                return;
            }
            const choice = llmResult.choice;
            const usedModel = choice.usedModel || model;
            const assistant = withAssistantModel(
                {
                    ...choice.message,
                    runId,
                },
                usedModel,
            );
            session = this.sessionStore.appendMessage(session.meta.id, assistant);
            this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: assistant });
            this.emit(IPC_CHANNELS.onSessionChanged, session);
        } catch (error) {
            if (error?.name === "AbortError" || this.cancelledRuns.has(sessionId)) {
                this.cancelledRuns.delete(sessionId);
                return;
            }
            this.emit(IPC_CHANNELS.onError, {
                sessionId,
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.clearAbortSignal(sessionId);
            this.setBusy(sessionId, false);
        }
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
        delete session.meta.postCompactContext;
        delete session.meta.recentFiles;
        delete session.meta.recentSkills;
        session.meta.compactFailures = 0;
        clearSessionMemory(session);
        this.sessionStore.save(session);
        this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: dividerMessage });
        this.emit(IPC_CHANNELS.onSessionChanged, session);
    }

    emitContextWarning(session) {
        const model = this.configStore.model(session.meta.providerKey, session.meta.modelId);
        const state = calculateContextWarningState(session, model, getContextConfig(this.configStore));
        this.emit(IPC_CHANNELS.onContextWarningChanged, {
            sessionId: session.meta.id,
            ...state,
        });
    }

    applyMicroCompact(session) {
        const contextConfig = getContextConfig(this.configStore);
        const fromIndex = Math.max(0, session.meta.llmContextFromIndex ?? 0);
        const active = session.messages.slice(fromIndex);
        const { cleared } = microCompactMessages(active, contextConfig);
        if (cleared) {
            session.meta.updatedAt = new Date().toISOString();
            this.sessionStore.save(session);
            this.emit(IPC_CHANNELS.onSessionChanged, session);
        }
        this.emitContextWarning(session);
        return session;
    }

    async maybeAutoCompact(sessionId) {
        const contextConfig = getContextConfig(this.configStore);
        if (!contextConfig.auto_compact_enabled || this.compactingSessions.has(sessionId)) {
            return false;
        }

        let session = this.sessionStore.get(sessionId);
        const model = this.configStore.model(session.meta.providerKey, session.meta.modelId);
        if (!shouldAutoCompact(session, model, contextConfig)) {
            return false;
        }

        await this.compactLlmContext(sessionId, {
            auto: true,
            preserveBusy: Boolean(this.busyBySession.get(sessionId)),
            silent: Boolean(this.busyBySession.get(sessionId)),
        });
        return true;
    }

    contextBlockedMessage(state) {
        const percent = state?.percent ?? 0;
        return (
            `上下文已接近模型上限（约 ${percent}%），自动压缩后仍超出安全范围。` +
            "请使用 /compact_context 或 /clear_context，或切换到更大上下文窗口的模型后继续。"
        );
    }

    subAgentBlockedMessage(description, state) {
        const percent = state?.percent ?? 0;
        return (
            `Sub-agent "${description}" stopped: context limit reached (about ${percent}%). ` +
            "Try a shorter task prompt, fewer tool rounds, or a model with a larger context window."
        );
    }

    async prepareContextForLlm(sessionId) {
        const contextConfig = getContextConfig(this.configStore);
        let session = this.sessionStore.get(sessionId);
        const model = this.configStore.model(session.meta.providerKey, session.meta.modelId);
        let state = calculateContextWarningState(session, model, contextConfig);
        this.emitContextWarning(session);

        if (!state.isAtBlockingLimit) {
            return { blocked: false, state };
        }

        await this.compactLlmContext(sessionId, {
            auto: true,
            preserveBusy: Boolean(this.busyBySession.get(sessionId)),
            silent: true,
        });
        session = this.sessionStore.get(sessionId);
        state = calculateContextWarningState(session, model, contextConfig);
        this.emitContextWarning(session);

        if (state.isAtBlockingLimit) {
            return { blocked: true, state };
        }
        return { blocked: false, state };
    }

    async requestAgentLlm(sessionId, invoke) {
        let overflowRetries = 0;

        while (true) {
            const prep = await this.prepareContextForLlm(sessionId);
            if (prep.blocked) {
                return { blocked: true, state: prep.state };
            }

            try {
                const choice = await invoke();
                return { blocked: false, choice };
            } catch (error) {
                if (error?.name === "AbortError") {
                    throw error;
                }
                if (
                    !isContextOverflowError(error) ||
                    overflowRetries >= MAX_CONTEXT_OVERFLOW_RETRIES
                ) {
                    throw error;
                }
                overflowRetries += 1;
                await this.compactLlmContext(sessionId, {
                    auto: true,
                    preserveBusy: Boolean(this.busyBySession.get(sessionId)),
                    silent: true,
                });
            }
        }
    }

    requestAgentChat(sessionId, chatArgs) {
        return this.requestAgentLlm(sessionId, () => this.llmClient.chat(chatArgs));
    }

    async prepareSubAgentContext(sessionId, messages, model) {
        const contextConfig = getContextConfig(this.configStore);
        let state = calculateMessagesContextWarningState(messages, model, contextConfig);
        this.emitContextWarning(this.sessionStore.get(sessionId));

        if (!state.isAtBlockingLimit) {
            return { blocked: false, state };
        }

        if (shrinkSubAgentMessages(messages, contextConfig)) {
            state = calculateMessagesContextWarningState(messages, model, contextConfig);
            if (!state.isAtBlockingLimit) {
                return { blocked: false, state };
            }
        }

        await this.compactLlmContext(sessionId, {
            auto: true,
            preserveBusy: Boolean(this.busyBySession.get(sessionId)),
            silent: true,
        });

        while (shrinkSubAgentMessages(messages, contextConfig)) {
            state = calculateMessagesContextWarningState(messages, model, contextConfig);
            if (!state.isAtBlockingLimit) {
                return { blocked: false, state };
            }
        }

        if (state.isAtBlockingLimit) {
            return { blocked: true, state };
        }
        return { blocked: false, state };
    }

    async requestSubAgentLlm(sessionId, messages, model, invoke) {
        const contextConfig = getContextConfig(this.configStore);
        let overflowRetries = 0;

        while (true) {
            const prep = await this.prepareSubAgentContext(sessionId, messages, model);
            if (prep.blocked) {
                return { blocked: true, state: prep.state };
            }

            try {
                const choice = await invoke();
                return { blocked: false, choice };
            } catch (error) {
                if (error?.name === "AbortError") {
                    throw error;
                }
                if (
                    !isContextOverflowError(error) ||
                    overflowRetries >= MAX_CONTEXT_OVERFLOW_RETRIES
                ) {
                    throw error;
                }
                overflowRetries += 1;
                if (!shrinkSubAgentMessages(messages, contextConfig)) {
                    await this.compactLlmContext(sessionId, {
                        auto: true,
                        preserveBusy: Boolean(this.busyBySession.get(sessionId)),
                        silent: true,
                    });
                    shrinkSubAgentMessages(messages, contextConfig);
                }
            }
        }
    }

    trackToolSideEffects(session, call, result) {
        const contextConfig = getContextConfig(this.configStore);
        if (call.function.name === "read_file") {
            let args = {};
            try {
                args = JSON.parse(call.function.arguments || "{}");
            } catch {
                args = {};
            }
            const parsed = parseReadFileResult(result, args);
            if (parsed) {
                trackReadFile(session, parsed.path, parsed.content, contextConfig);
                this.sessionStore.save(session);
            }
            return session;
        }
        if (call.function.name === "load_skill") {
            let args = {};
            try {
                args = JSON.parse(call.function.arguments || "{}");
            } catch {
                args = {};
            }
            const skillName = String(args.name || args.url || "skill").trim();
            if (skillName) {
                trackLoadedSkill(session, skillName, result, contextConfig);
                this.sessionStore.save(session);
            }
        }
        return session;
    }

    async refreshSessionMemory(sessionId) {
        const contextConfig = getContextConfig(this.configStore);
        if (!contextConfig.session_memory_enabled || this.compactingSessions.has(sessionId)) {
            return;
        }

        let session = this.sessionStore.get(sessionId);
        if (!shouldRefreshSessionMemory(session)) {
            return;
        }

        session.meta.sessionMemoryRefreshBusy = true;
        this.sessionStore.save(session);

        try {
            const pendingMessages = getPendingMemoryMessages(session);
            const transcript = buildSessionMemoryTranscript(session, pendingMessages);
            const choice = await this.llmClient.complete({
                model: {
                    providerKey: session.meta.providerKey,
                    modelId: session.meta.modelId,
                },
                modelChain: this.modelChainForSession(session),
                messages: [
                    { role: "system", content: SESSION_MEMORY_UPDATE_SYSTEM },
                    { role: "user", content: transcript },
                ],
            });
            const memory = formatSessionMemory(choice.message.content || "");
            if (!memory) {
                return;
            }

            session = this.sessionStore.get(sessionId);
            let lastIndex = session.messages.length - 1;
            while (lastIndex >= 0 && isContextDividerMessage(session.messages[lastIndex])) {
                lastIndex -= 1;
            }
            session.meta.sessionMemory = memory;
            session.meta.sessionMemoryUpToIndex = Math.max(
                session.meta.llmContextFromIndex ?? 0,
                lastIndex,
            );
            session.meta.sessionMemoryUpdatedAt = new Date().toISOString();
            delete session.meta.sessionMemoryRefreshBusy;
            this.sessionStore.save(session);
            this.emit(IPC_CHANNELS.onSessionChanged, session);
            this.emitContextWarning(session);
        } catch (error) {
            console.warn(
                `[CRAgent] session memory refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            session = this.sessionStore.get(sessionId);
            delete session.meta.sessionMemoryRefreshBusy;
            this.sessionStore.save(session);
        }
    }

    async compactLlmContext(sessionId, options = {}) {
        const { auto = false, preserveBusy = false, silent = false } = options;
        if (this.compactingSessions.has(sessionId)) {
            return;
        }
        this.compactingSessions.add(sessionId);
        const manageBusy = !preserveBusy;
        if (manageBusy) {
            this.setBusy(sessionId, true);
        }
        try {
            const contextConfig = getContextConfig(this.configStore);
            let session = this.sessionStore.get(sessionId);
            const entries = getActiveContextEntries(session);
            let activeMessages = entries.map((entry) => entry.message);

            preCompactMicroCompact(activeMessages, contextConfig);
            this.sessionStore.save(session);

            const { toSummarize, keep, keepStartIndex } = splitMessagesForCompact(
                activeMessages,
                contextConfig,
            );

            if (!toSummarize.length) {
                if (!auto) {
                    const notice = withAssistantModel(
                        {
                            id: randomUUID(),
                            role: "assistant",
                            content: "当前上下文过短，暂无需压缩。",
                            createdAt: new Date().toISOString(),
                        },
                        { modelId: session.meta.modelId },
                    );
                    session = this.sessionStore.appendMessage(sessionId, notice);
                    this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: notice });
                    this.emit(IPC_CHANNELS.onSessionChanged, session);
                }
                return;
            }

            let summary = null;
            let compactMethod = "full_llm";
            const memoryCompact = trySessionMemoryCompact(session, entries, keepStartIndex);
            if (memoryCompact.ok && contextConfig.session_memory_enabled) {
                summary = memoryCompact.summary;
                compactMethod = memoryCompact.method;
            } else {
                session = this.sessionStore.get(sessionId);
                const { transcript, droppedGroups } = buildCompactTranscript(
                    session,
                    toSummarize,
                    contextConfig,
                );

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
                summary = formatCompactSummary(choice.message.content || "");
                if (droppedGroups > 0 && summary) {
                    summary = `[Note: ${droppedGroups} oldest API round(s) omitted from compact input due to size limits]\n\n${summary}`;
                }
            }

            if (!summary) {
                session = this.sessionStore.get(sessionId);
                session.meta.compactFailures = (session.meta.compactFailures ?? 0) + 1;
                this.sessionStore.save(session);
                this.emit(IPC_CHANNELS.onError, {
                    sessionId,
                    message: auto
                        ? "自动压缩失败：模型未返回有效摘要。"
                        : "压缩失败：模型未返回有效摘要。",
                });
                return;
            }

            const dividerMessage = {
                id: randomUUID(),
                role: CONTEXT_DIVIDER_ROLE,
                content: CONTEXT_COMPACT_DIVIDER_LABEL,
                createdAt: new Date().toISOString(),
            };
            session = this.sessionStore.get(sessionId);
            const sessionKeepIndex = entries[keepStartIndex]?.index ?? entries[0]?.index ?? 0;
            session.messages.splice(sessionKeepIndex, 0, dividerMessage);
            session.meta.llmContextFromIndex = sessionKeepIndex + 1;
            session.meta.contextSummary = summary;
            session.meta.postCompactContext =
                buildPostCompactContext(session, contextConfig) || undefined;
            if (!session.meta.postCompactContext) {
                delete session.meta.postCompactContext;
            }
            session.meta.compactFailures = 0;
            session.meta.updatedAt = new Date().toISOString();
            const lastSummarizedIndex = entries[keepStartIndex - 1]?.index ?? sessionKeepIndex - 1;
            syncSessionMemoryAfterCompact(session, summary, lastSummarizedIndex);
            this.sessionStore.save(session);
            this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: dividerMessage });
            this.emit(IPC_CHANNELS.onSessionChanged, session);
            this.emitContextWarning(session);

            if (!silent) {
                const methodNote =
                    compactMethod === "session_memory"
                        ? "（使用 Session Memory，未调用完整摘要）"
                        : "";
                const restoredNote = session.meta.postCompactContext
                    ? "，并恢复了最近读取的文件/技能摘要"
                    : "";
                const feedback = withAssistantModel(
                    {
                        id: randomUUID(),
                        role: "assistant",
                        content: auto
                            ? `[自动压缩${methodNote}] 已将 ${toSummarize.length} 条较早消息压缩为结构化摘要，保留最近 ${keep.length} 条完整消息${restoredNote}。`
                            : `已压缩 ${toSummarize.length} 条较早消息为结构化摘要，保留最近 ${keep.length} 条消息完整上下文${restoredNote}。`,
                        createdAt: new Date().toISOString(),
                    },
                    { modelId: session.meta.modelId },
                );
                session = this.sessionStore.appendMessage(sessionId, feedback);
                this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: feedback });
                this.emit(IPC_CHANNELS.onSessionChanged, session);
            }
        } catch (error) {
            const session = this.sessionStore.get(sessionId);
            session.meta.compactFailures = (session.meta.compactFailures ?? 0) + 1;
            this.sessionStore.save(session);
            this.emit(IPC_CHANNELS.onError, {
                sessionId,
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.compactingSessions.delete(sessionId);
            if (manageBusy) {
                this.setBusy(sessionId, false);
            }
        }
    }

    async runLoop(session, runId) {
        const sessionId = session.meta.id;
        this.setBusy(sessionId, true);
        const signal = this.createAbortSignal(sessionId);
        try {
            const agent = this.defaultAgent();
            const maxRounds = Math.max(1, agent?.max_tool_rounds ?? 8);
            const toolsEnabled = agent?.tools?.enable_tools !== false;
            const unlockedToolNames = new Set();
            let round = 0;

            while (round < maxRounds) {
                if (this.wasRunCancelled(sessionId)) {
                    return;
                }
                session = this.sessionStore.get(sessionId);
                session = this.applyMicroCompact(session);
                await this.maybeAutoCompact(sessionId);
                session = this.sessionStore.get(sessionId);
                const model = {
                    providerKey: session.meta.providerKey,
                    modelId: session.meta.modelId,
                };
                const chatResult = await this.requestAgentChat(sessionId, {
                    messages: this.messagesForLLM(session),
                    model,
                    modelChain: this.modelChainForSession(session),
                    tools: toolsEnabled
                        ? this.toolRegistry.schemas({ unlockedToolNames })
                        : [],
                    signal,
                });
                if (this.wasRunCancelled(sessionId)) {
                    return;
                }
                if (chatResult.blocked) {
                    const blockedMessage = withAssistantModel(
                        {
                            id: randomUUID(),
                            role: "assistant",
                            content: this.contextBlockedMessage(chatResult.state),
                            createdAt: new Date().toISOString(),
                            runId,
                        },
                        { modelId: session.meta.modelId },
                    );
                    session = this.sessionStore.appendMessage(sessionId, blockedMessage);
                    this.emit(IPC_CHANNELS.onMessageAppended, {
                        sessionId,
                        message: blockedMessage,
                    });
                    this.emit(IPC_CHANNELS.onSessionChanged, session);
                    return;
                }
                const choice = chatResult.choice;
                const usedModel = choice.usedModel || model;
                let assistant = withAssistantModel({ ...choice.message, runId }, usedModel);
                if (choice.usedFallback && choice.usedModel) {
                    const note = `(已自动切换至备用模型 ${choice.usedModel.providerKey}/${choice.usedModel.modelId})\n\n`;
                    assistant = { ...assistant, content: `${note}${assistant.content || ""}` };
                }
                session = this.sessionStore.appendMessage(session.meta.id, assistant);
                this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: assistant });
                this.emit(IPC_CHANNELS.onSessionChanged, session);

                const calls = assistant.toolCalls || [];
                if (!calls.length) {
                    void this.refreshSessionMemory(sessionId);
                    return;
                }

                for (const call of calls) {
                    if (this.wasRunCancelled(sessionId)) {
                        return;
                    }
                    const result = await this.toolRegistry.execute(call, {
                        sessionId,
                        runId,
                        unlockedToolNames,
                    });
                    if (call.function.name === "TodoWrite") {
                        this.emit(IPC_CHANNELS.onTodosChanged, {
                            sessionId,
                            runId,
                            todos: this.sessionStore.get(sessionId).meta.todoRuns?.[runId]?.todos || [],
                            todoRuns: this.sessionStore.get(sessionId).meta.todoRuns || {},
                        });
                    }
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
                    session = this.trackToolSideEffects(session, call, result);
                }
                round += 1;
            }

            const limitMessage = withAssistantModel(
                {
                    id: randomUUID(),
                    role: "assistant",
                    content: "已达到工具调用上限，请回复继续。",
                    createdAt: new Date().toISOString(),
                    runId,
                },
                { modelId: session.meta.modelId },
            );
            session = this.sessionStore.appendMessage(sessionId, limitMessage);
            this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: limitMessage });
            this.emit(IPC_CHANNELS.onSessionChanged, session);
        } catch (error) {
            if (error?.name === "AbortError" || this.cancelledRuns.has(sessionId)) {
                this.cancelledRuns.delete(sessionId);
                return;
            }
            this.emit(IPC_CHANNELS.onError, {
                sessionId,
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.clearAbortSignal(sessionId);
            this.setBusy(sessionId, false);
        }
    }
}
