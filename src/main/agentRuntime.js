import { randomUUID } from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";
import {
    CONTEXT_COMPACT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_LABEL,
    CONTEXT_DIVIDER_ROLE,
    getActiveLlmContextEntries,
    getActiveLlmContextStartIndex,
    isContextDividerMessage,
    normalizeMessagesForLlm,
    sessionHasActiveLlmContext,
    trimStaleComputerScreenshots,
    withAssistantModel,
} from "@shared/chatMessages";
import { IPC_CHANNELS } from "@shared/ipc";
import {
    buildComputerUsePrompt,
    parseComputerUseInvocation,
} from "@shared/chatCommands.js";
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
    MAX_AUTO_COMPACT_ROUNDS,
    MAX_MANUAL_COMPACT_ROUNDS,
    mergeCompactKeepSettings,
    microCompactMessages,
    microCompactMessagesIfNeeded,
    parseReadFileResult,
    preCompactMicroCompact,
    resolveCompactKeepSettings,
    resolveMicroCompactKeepRecent,
    shouldAutoCompact,
    shouldRunMicroCompact,
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
import {
    resolvePathInWorkspace,
    resolveSessionWorkspace,
    resolveWorkspace,
} from "./workspacePaths.js";
import { HookRunner } from "./hooks/hookRunner.js";
import { resolveHooksConfig } from "./hooks/hookPaths.js";
import { attachContextCategoryPreviews } from "./contextDetailPreviews.js";
import { mergeUiConfig } from "@shared/uiConfig.js";
import {
    buildExitPlanModeUserMessage,
    buildPlanRejectionUserMessage,
    buildPlanModeSystemPrompt,
    filterToolsForPlanMode,
    getPlanDisplayPath,
    planFileExists,
    readPlanFile,
    validatePlanModeToolCall,
    writePlanFile,
} from "./planMode.js";
import { ensureSessionPlanFile } from "@shared/sessionPlanPaths.js";
import {
    estimateMcpToolDefinitionTokens,
    getEnabledMcpServers,
} from "@shared/mcpConfig.js";
import {
    CONTEXT_BREAKDOWN_CATEGORIES,
    estimateSessionContextBreakdown,
    estimateTextTokens,
    reconcileContextBreakdownCategories,
} from "@shared/tokenEstimator.js";
import { ipcPayloadForRenderer } from "./rendererSession.js";
import { normalizeExecutionMode } from "@shared/executionMode.js";
import { normalizeToolResult, toolResultContent } from "@shared/toolResult.js";
import { computerUseSystemPromptSection } from "./tools/computerUseTools.js";
import { webSearchSystemPromptSection } from "./tools/webSearchTools.js";
import { isWebSearchAvailable } from "./webSearchService.js";
import { computerActionFingerprint, formatComputerLoopNudge } from "./computerUse.js";
import { rejectAllPendingConfirms } from "./confirmBridge.js";
import {
    enforceToolResultBudget,
    finalizeToolResultForLlm,
    isPersistedToolResultContent,
    loadToolResultBudgetState,
    resolveToolMaxResultSizeChars,
    serializeToolResultBudgetState,
} from "./toolResultStorage.js";

const HOOK_LOG_LIMIT = 80;
const SUB_AGENT_OUTPUTS_DIR = "sub-agent-outputs";
const RISKY_INTERACTIVE_TOOL_NAMES = new Set([
    "web_fetch",
    "computer_action",
    "computer_displays",
    "computer_screenshot",
    "computer_move",
    "computer_click",
    "computer_type",
    "computer_key",
    "computer_scroll",
]);

function messageText(message) {
    const content = message?.content;
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") {
                    return part;
                }
                return part?.text || "";
            })
            .join("\n");
    }
    return "";
}

function latestUserText(session) {
    for (let index = (session?.messages?.length || 0) - 1; index >= 0; index -= 1) {
        const message = session.messages[index];
        if (message?.role === "user") {
            return messageText(message);
        }
    }
    return "";
}

export function shouldExposeRiskyInteractiveTools(input) {
    const text = String(input || "").toLowerCase();
    if (!text.trim()) {
        return true;
    }
    return /(\b(open\s+(app|chrome|safari|browser|url|website|webpage)|browse|click|type|desktop|screen|screenshot|browser|chrome|safari|fetch|url|http|website|webpage|search|google)\b|打开|浏览|点击|输入|屏幕|截图|浏览器|网页|网址|搜索|谷歌|访问)/i.test(
        text,
    );
}

export function filterToolsForLatestUserIntent(tools, input) {
    if (shouldExposeRiskyInteractiveTools(input)) {
        return tools;
    }
    return tools.filter((tool) => !RISKY_INTERACTIVE_TOOL_NAMES.has(tool.name));
}

export class AgentRuntime {
    constructor(
        sessionStore,
        configStore,
        llmClient,
        toolRegistry,
        workspaceMemory,
        skillLoader,
        mainWindowGetter,
        diagnosticLogger = null,
    ) {
        this.sessionStore = sessionStore;
        this.configStore = configStore;
        this.llmClient = llmClient;
        this.toolRegistry = toolRegistry;
        this.workspaceMemory = workspaceMemory;
        this.skillLoader = skillLoader;
        this.mainWindowGetter = mainWindowGetter;
        this.diagnosticLogger = diagnosticLogger;
        this.busyBySession = new Map();
        this.compactingSessions = new Set();
        this.autoCompactTimers = new Map();
        this.pendingQueues = new Map();
        this.abortControllers = new Map();
        this.activeRunIdBySession = new Map();
        this.cancelledRunIds = new Set();
        this.hookLogsBySession = new Map();
        this.hookRunner = new HookRunner({
            getHooksConfig: (sessionId) =>
                resolveHooksConfig({
                    sessionStore: this.sessionStore,
                    configStore: this.configStore,
                    sessionId,
                }),
            getSessionMeta: (sessionId) => {
                const session = this.sessionStore.get(sessionId);
                return {
                    transcriptPath: this.sessionStore.transcriptPath(sessionId),
                    cwd: resolveSessionWorkspace(this.sessionStore, this.configStore, sessionId),
                    permissionMode: session.meta.authMode || "default",
                };
            },
            isEnabled: () => mergeUiConfig(this.configStore.get().ui).hooks_enabled !== false,
            onHookEvent: (entry) => this.recordHookLog(entry),
        });
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
        this.mainWindowGetter()?.webContents.send(channel, ipcPayloadForRenderer(channel, payload));
    }

    async logDiagnostic(level, event, fields = {}) {
        const writer = this.diagnosticLogger?.[level];
        if (typeof writer !== "function") {
            return;
        }
        try {
            await writer(event, fields);
        } catch (error) {
            console.warn("[CRAgent][Log] diagnostic logger failed:", error);
        }
    }

    logInfo(event, fields = {}) {
        return this.logDiagnostic("info", event, fields);
    }

    logWarn(event, fields = {}) {
        return this.logDiagnostic("warn", event, fields);
    }

    logError(event, fields = {}) {
        return this.logDiagnostic("error", event, fields);
    }

    getHookLogs(sessionId) {
        return [...(this.hookLogsBySession.get(sessionId) || [])];
    }

    clearHookLogs(sessionId) {
        if (sessionId) {
            this.hookLogsBySession.delete(sessionId);
            this.emit(IPC_CHANNELS.onHookLog, { sessionId, logs: [] });
            return;
        }
        this.hookLogsBySession.clear();
    }

    recordHookLog(entry) {
        const sessionId = entry?.sessionId;
        if (!sessionId) {
            return;
        }
        const list = this.hookLogsBySession.get(sessionId) || [];
        const existingIndex = entry.id ? list.findIndex((row) => row.id === entry.id) : -1;
        if (existingIndex >= 0 && entry.status === "running") {
            list[existingIndex] = { ...list[existingIndex], ...entry };
        } else if (existingIndex >= 0) {
            list[existingIndex] = { ...list[existingIndex], ...entry };
        } else {
            list.push(entry);
        }
        while (list.length > HOOK_LOG_LIMIT) {
            list.shift();
        }
        this.hookLogsBySession.set(sessionId, list);
        this.emit(IPC_CHANNELS.onHookLog, { sessionId, entry, logs: list });
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

    sessionExecutionMode(sessionOrId) {
        if (typeof sessionOrId === "string") {
            try {
                const session = this.sessionStore.get(sessionOrId, {
                    loadAllMessages: false,
                    hydrateImages: false,
                });
                return normalizeExecutionMode(session.meta.executionMode);
            } catch {
                return normalizeExecutionMode(undefined);
            }
        }
        return normalizeExecutionMode(sessionOrId?.meta?.executionMode);
    }

    executionMode(sessionOrId) {
        return this.sessionExecutionMode(sessionOrId);
    }

    resolveSessionPlan(sessionId) {
        const sessionsDir = this.sessionStore.locateSessionStorage(sessionId);
        const workspace = resolveSessionWorkspace(this.sessionStore, this.configStore, sessionId);
        const filePath = ensureSessionPlanFile(sessionsDir, sessionId, workspace);
        return {
            sessionsDir,
            workspace,
            filePath,
            displayPath: getPlanDisplayPath(),
        };
    }

    buildSystemPromptContent(session) {
        const parts = [];
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
                    "Do not write agent task files under .cragent/ in the project tree. " +
                    "Use write_file with plan.md or paths relative to session storage (stored under ~/.CRAgent/sessions/<projectsRootGuid>/<projectId>/<sessionId>/).\n" +
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
        if (agent?.tools?.enable_computer_use === true) {
            parts.push(computerUseSystemPromptSection());
        }
        if (
            agent?.tools?.enable_web_search === true &&
            isWebSearchAvailable(
                this.configStore.get(),
                session.meta.providerKey,
                session.meta.modelId,
            )
        ) {
            parts.push(webSearchSystemPromptSection());
        }
        if (this.sessionExecutionMode(session) === "plan") {
            const { filePath: planFilePath, sessionsDir, workspace } = this.resolveSessionPlan(
                session.meta.id,
            );
            parts.push(
                buildPlanModeSystemPrompt({
                    planFilePath,
                    planExists: planFileExists(sessionsDir, session.meta.id, workspace),
                }),
            );
        }
        const todoPrompt = formatTodosForPrompt(session.meta.todos);
        if (todoPrompt) {
            parts.push(todoPrompt);
        }
        return parts.join("\n\n");
    }

    getSessionContextDetail(sessionId) {
        const session = this.sessionStore.get(sessionId, {
            loadAllMessages: true,
            hydrateImages: false,
        });
        const config = this.configStore.get();
        const model = this.configStore.model(session.meta.providerKey, session.meta.modelId);
        const agent = this.defaultAgent();
        const agentTools = agent?.tools || {};
        const skillsCatalogText = this.skillLoader
            .listSummaries()
            .map((skill) => `- ${skill.name}: ${skill.description || ""}`)
            .join("\n");
        const mcpServers = getEnabledMcpServers(config);
        const mcpTokens =
            agentTools.enable_mcp !== false
                ? estimateMcpToolDefinitionTokens(
                      mcpServers.length > 0 ? mcpServers.length * 2 : 0,
                  )
                : 0;
        const breakdown = estimateSessionContextBreakdown(session, model, {
            compactBufferTokens: config.context?.compact_buffer_tokens,
            autoCompactThresholdPercent: config.context?.auto_compact_threshold_percent,
            agentTools,
            skillsCatalogText,
            mcpTokens,
        });
        const systemPromptText = this.buildSystemPromptContent(session);
        let categories = attachContextCategoryPreviews({
            session,
            config,
            agentTools,
            toolRegistry: this.toolRegistry,
            skillLoader: this.skillLoader,
            workspaceRoot: resolveWorkspace(this.configStore),
            systemPromptText,
            categories: breakdown.categories,
        });
        if (systemPromptText) {
            const systemTokens = estimateTextTokens(systemPromptText);
            const systemDefinition = CONTEXT_BREAKDOWN_CATEGORIES.find(
                (category) => category.id === "systemPrompt",
            );
            const existingIndex = categories.findIndex((category) => category.id === "systemPrompt");
            if (existingIndex >= 0) {
                categories[existingIndex] = {
                    ...categories[existingIndex],
                    tokens: systemTokens,
                    previewText: systemPromptText,
                };
            } else if (systemDefinition) {
                categories.unshift({
                    ...systemDefinition,
                    tokens: systemTokens,
                    previewText: systemPromptText,
                });
            }
        }
        categories = reconcileContextBreakdownCategories(
            categories.filter((category) => category.tokens > 0),
            breakdown.tokens,
        );
        this.scheduleAutoCompactIfNeeded(sessionId);
        return { ...breakdown, categories, systemPromptText };
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
        const systemContent = this.buildSystemPromptContent(session);
        if (systemContent) {
            parts.push(systemContent);
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
        const fromIndex = getActiveLlmContextStartIndex(session);
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
        if (session.meta.sessionMemory) {
            messages.push({
                id: randomUUID(),
                role: "user",
                content: `<session_memory>\n${session.meta.sessionMemory}\n</session_memory>`,
                createdAt: new Date().toISOString(),
            });
        }
        if (includeSessionHistory) {
            const history = session.messages
                .slice(fromIndex)
                .filter((message) => !isContextDividerMessage(message));
            messages.push(
                ...normalizeMessagesForLlm(trimStaleComputerScreenshots(history)),
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

    enqueueMessage(sessionId, rawInput, images = [], atMentions = [], userText = null, options = {}) {
        const queue = this.pendingQueues.get(sessionId) || [];
        queue.push({
            id: randomUUID(),
            input: rawInput,
            images,
            atMentions: normalizeAtMentions(atMentions),
            userText,
            options,
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

    reorderQueuedMessages(sessionId, fromIndex, toIndex) {
        const queue = this.pendingQueues.get(sessionId) || [];
        if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= queue.length ||
            toIndex >= queue.length ||
            fromIndex === toIndex
        ) {
            return;
        }
        const [item] = queue.splice(fromIndex, 1);
        queue.splice(toIndex, 0, item);
        this.pendingQueues.set(sessionId, queue);
        this.emit(IPC_CHANNELS.onQueueChanged, { sessionId, queue: [...queue] });
    }

    cancelRun(sessionId) {
        const runId = this.activeRunIdBySession.get(sessionId);
        void this.logWarn("agent.run.cancel", { sessionId, runId });
        if (runId) {
            this.cancelledRunIds.add(runId);
        }
        this.abortControllers.get(sessionId)?.abort();
        this.pendingQueues.set(sessionId, []);
        this.emit(IPC_CHANNELS.onQueueChanged, { sessionId, queue: [] });
        rejectAllPendingConfirms();
        this.setBusy(sessionId, false);
    }

    async processQueue(sessionId) {
        if (this.busyBySession.get(sessionId)) {
            return;
        }
        const next = this.dequeueNextMessage(sessionId);
        if (!next) {
            return;
        }
        await this.dispatchUserMessage(
            sessionId,
            next.input,
            next.images,
            next.atMentions,
            next.userText,
            next.options || {},
        );
    }

    createAbortSignal(sessionId) {
        const controller = new AbortController();
        this.abortControllers.set(sessionId, controller);
        return controller;
    }

    clearAbortSignal(sessionId, controller) {
        if (this.abortControllers.get(sessionId) === controller) {
            this.abortControllers.delete(sessionId);
        }
    }

    wasRunCancelled(runId) {
        if (!this.cancelledRunIds.has(runId)) {
            return false;
        }
        this.cancelledRunIds.delete(runId);
        return true;
    }

    isRunCancelled(runId) {
        return Boolean(runId && this.cancelledRunIds.has(runId));
    }

    hookExtrasFromContext(context = {}) {
        const extra = {};
        if (context.isSubAgent) {
            extra.agent_id = context.runId;
            if (context.subagentType) {
                extra.agent_type = context.subagentType;
            }
        }
        return extra;
    }

    parseToolCallArguments(call) {
        const raw = call?.function?.arguments;
        if (raw != null && typeof raw === "object") {
            return raw;
        }
        try {
            return JSON.parse(raw || "{}");
        } catch {
            return null;
        }
    }

    async ensureSessionStartHook(sessionId) {
        let session = this.sessionStore.get(sessionId);
        if (session.meta.hooksSessionStarted) {
            return;
        }
        await this.hookRunner.run(
            "SessionStart",
            this.hookRunner.buildBaseInput(sessionId, "SessionStart", { source: "startup" }),
            { matchQuery: "startup" },
        );
        session = this.sessionStore.get(sessionId);
        session.meta.hooksSessionStarted = true;
        this.sessionStore.save(session);
    }

    async runUserPromptSubmitHook(sessionId, prompt) {
        return this.hookRunner.run(
            "UserPromptSubmit",
            this.hookRunner.buildBaseInput(sessionId, "UserPromptSubmit", { prompt }),
            { matchQuery: prompt },
        );
    }

    async runStopHook(sessionId, lastAssistantMessage, signal) {
        return this.hookRunner.run(
            "Stop",
            this.hookRunner.buildBaseInput(sessionId, "Stop", {
                stop_hook_active: false,
                last_assistant_message: lastAssistantMessage,
            }),
            { signal },
        );
    }

    appendHookBlockedAssistant(sessionId, reason, runId) {
        const session = this.sessionStore.get(sessionId);
        const blockedMessage = withAssistantModel(
            {
                id: randomUUID(),
                role: "assistant",
                content: reason,
                createdAt: new Date().toISOString(),
                runId,
            },
            { modelId: session.meta.modelId },
        );
        const updated = this.sessionStore.appendMessage(sessionId, blockedMessage);
        this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: blockedMessage });
        this.emit(IPC_CHANNELS.onSessionChanged, updated);
    }

    async executeToolWithHooks(call, context, signal) {
        const sessionId = context.sessionId;
        const toolName = call.function.name;
        let toolInput = this.parseToolCallArguments(call);
        if (toolInput === null) {
            await this.logWarn("agent.tool.invalid_arguments", {
                sessionId,
                runId: context.runId,
                toolName,
                toolCallId: call.id,
            });
            return `Error: invalid tool arguments`;
        }
        const startedAt = Date.now();
        await this.logInfo("agent.tool.start", {
            sessionId,
            runId: context.runId,
            toolName,
            toolCallId: call.id,
            isSubAgent: Boolean(context.isSubAgent),
        });

        if (context.planMode) {
            const { filePath: planFilePath, workspace } = this.resolveSessionPlan(sessionId);
            const planError = validatePlanModeToolCall(
                toolName,
                toolInput,
                planFilePath,
                workspace,
                sessionId,
            );
            if (planError) {
                await this.logWarn("agent.tool.finish", {
                    sessionId,
                    runId: context.runId,
                    toolName,
                    toolCallId: call.id,
                    status: "blocked",
                    reason: "plan_mode_policy",
                    durationMs: Date.now() - startedAt,
                });
                return planError;
            }
        }

        const hookExtras = this.hookExtrasFromContext(context);

        if (toolName === "bash" && toolInput.command) {
            const shellHook = await this.hookRunner.run(
                "BeforeShellExecution",
                this.hookRunner.buildBaseInput(sessionId, "BeforeShellExecution", {
                    command: String(toolInput.command),
                    ...hookExtras,
                }),
                { matchQuery: String(toolInput.command), signal },
            );
            if (shellHook.blocked) {
                await this.logWarn("agent.tool.finish", {
                    sessionId,
                    runId: context.runId,
                    toolName,
                    toolCallId: call.id,
                    status: "blocked",
                    reason: "shell_hook",
                    durationMs: Date.now() - startedAt,
                });
                return `Error: ${shellHook.reason || "Blocked by shell hook"}`;
            }
        }

        const preHook = await this.hookRunner.run(
            "PreToolUse",
            this.hookRunner.buildBaseInput(sessionId, "PreToolUse", {
                tool_name: toolName,
                tool_input: toolInput,
                tool_use_id: call.id,
                ...hookExtras,
            }),
            { matchQuery: toolName, signal },
        );
        if (preHook.blocked) {
            await this.logWarn("agent.tool.finish", {
                sessionId,
                runId: context.runId,
                toolName,
                toolCallId: call.id,
                status: "blocked",
                reason: "pre_tool_hook",
                durationMs: Date.now() - startedAt,
            });
            return `Error: ${preHook.reason || "Blocked by hook"}`;
        }
        if (preHook.updatedInput) {
            toolInput = preHook.updatedInput;
            call = {
                ...call,
                function: {
                    ...call.function,
                    arguments: JSON.stringify(toolInput),
                },
            };
        }

        let result;
        try {
            result = await this.toolRegistry.execute(call, context);
        } catch (error) {
            await this.logError("agent.tool.finish", {
                sessionId,
                runId: context.runId,
                toolName,
                toolCallId: call.id,
                status: "exception",
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                durationMs: Date.now() - startedAt,
            });
            throw error;
        }
        let normalized = normalizeToolResult(result);
        const failed = normalized.content.startsWith("Error:");

        if (failed) {
            await this.logWarn("agent.tool.finish", {
                sessionId,
                runId: context.runId,
                toolName,
                toolCallId: call.id,
                status: "error",
                durationMs: Date.now() - startedAt,
                resultChars: normalized.content.length,
            });
            const failHook = await this.hookRunner.run(
                "PostToolUseFailure",
                this.hookRunner.buildBaseInput(sessionId, "PostToolUseFailure", {
                    tool_name: toolName,
                    tool_input: toolInput,
                    tool_use_id: call.id,
                    error: normalized.content,
                    ...hookExtras,
                }),
                { matchQuery: toolName, signal },
            );
            if (failHook.additionalContext) {
                normalized = normalizeToolResult(
                    `${normalized.content}\n\n${failHook.additionalContext}`,
                );
            }
            return normalized;
        }

        const postHook = await this.hookRunner.run(
            "PostToolUse",
            this.hookRunner.buildBaseInput(sessionId, "PostToolUse", {
                tool_name: toolName,
                tool_input: toolInput,
                tool_response: normalized.content,
                tool_use_id: call.id,
                ...hookExtras,
            }),
            { matchQuery: toolName, signal },
        );
        if (postHook.updatedToolOutput !== undefined) {
            normalized = normalizeToolResult(postHook.updatedToolOutput);
        }
        if (postHook.additionalContext) {
            normalized = {
                ...normalized,
                content: `${normalized.content}\n\n${postHook.additionalContext}`,
            };
        }

        if (toolName === "bash" && toolInput.command) {
            await this.hookRunner.run(
                "AfterShellExecution",
                this.hookRunner.buildBaseInput(sessionId, "AfterShellExecution", {
                    command: String(toolInput.command),
                    output: normalized.content,
                    ...hookExtras,
                }),
                { matchQuery: String(toolInput.command), signal },
            );
        }

        await this.logInfo("agent.tool.finish", {
            sessionId,
            runId: context.runId,
            toolName,
            toolCallId: call.id,
            status: "success",
            durationMs: Date.now() - startedAt,
            resultChars: normalized.content.length,
        });
        return normalized;
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
        await this.hookRunner.run(
            "SubagentStart",
            this.hookRunner.buildBaseInput(sessionId, "SubagentStart", {
                agent_id: subRunId,
                agent_type: subagentType,
            }),
            { matchQuery: subagentType },
        );
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
                await this.hookRunner.run(
                    "SubagentStop",
                    this.hookRunner.buildBaseInput(sessionId, "SubagentStop", {
                        stop_hook_active: false,
                        agent_id: subRunId,
                        agent_type: subagentType,
                        last_assistant_message: body,
                    }),
                    { matchQuery: subagentType },
                );
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
                const result = await this.executeToolWithHooks(call, {
                    sessionId,
                    sessionsDir: this.sessionStore.locateSessionStorage(sessionId),
                    runId: subRunId,
                    parentRunId,
                    isSubAgent: true,
                    subagentType,
                    unlockedToolNames,
                });
                if (
                    call.function.name === "download_skill" ||
                    call.function.name === "delete_skill"
                ) {
                    this.skillLoader.reload();
                }
                const normalized = await this.finalizeToolMessageResult(sessionId, call, result);
                messages.push({
                    id: randomUUID(),
                    role: "tool",
                    name: call.function.name,
                    toolCallId: call.id,
                    content: normalized.content,
                    ...(normalized.images ? { images: normalized.images } : {}),
                    createdAt: new Date().toISOString(),
                    runId: subRunId,
                });
            }
            round += 1;
        }

        await this.hookRunner.run(
            "SubagentStop",
            this.hookRunner.buildBaseInput(sessionId, "SubagentStop", {
                stop_hook_active: false,
                agent_id: subRunId,
                agent_type: subagentType,
            }),
            { matchQuery: subagentType },
        );
        return `Sub-agent "${description}" reached tool round limit before finishing.`;
    }

    subAgentOutputPath(sessionId, agentId) {
        const sessionsDir = this.sessionStore.locateSessionStorage(sessionId);
        const safeId = String(agentId || "").replace(/[^a-zA-Z0-9._-]/g, "_");
        return path.join(sessionsDir, sessionId, SUB_AGENT_OUTPUTS_DIR, `${safeId}.txt`);
    }

    async writeSubAgentOutput(sessionId, agentId, content) {
        const outputFile = this.subAgentOutputPath(sessionId, agentId);
        await fsPromises.mkdir(path.dirname(outputFile), { recursive: true });
        await fsPromises.writeFile(outputFile, content, "utf-8");
        return outputFile;
    }

    async runSubAgentInBackground({
        sessionId,
        parentRunId,
        description,
        prompt,
        subagentType = "generalPurpose",
        modelOverride = null,
    }) {
        const agentId = randomUUID();
        const startedAt = new Date().toISOString();
        const pending = [
            "status: running",
            `agent_id: ${agentId}`,
            `description: ${description}`,
            `started_at: ${startedAt}`,
            "",
            "Background sub-agent is still running.",
        ].join("\n");
        const outputFile = await this.writeSubAgentOutput(sessionId, agentId, pending);

        void (async () => {
            try {
                const result = await this.runSubAgent({
                    sessionId,
                    parentRunId,
                    description,
                    prompt,
                    subagentType,
                    modelOverride,
                });
                await this.writeSubAgentOutput(
                    sessionId,
                    agentId,
                    [
                        "status: completed",
                        `agent_id: ${agentId}`,
                        `description: ${description}`,
                        `started_at: ${startedAt}`,
                        `completed_at: ${new Date().toISOString()}`,
                        "",
                        result,
                    ].join("\n"),
                );
            } catch (error) {
                await this.writeSubAgentOutput(
                    sessionId,
                    agentId,
                    [
                        "status: error",
                        `agent_id: ${agentId}`,
                        `description: ${description}`,
                        `started_at: ${startedAt}`,
                        `completed_at: ${new Date().toISOString()}`,
                        "",
                        `Error: ${error?.message || error}`,
                    ].join("\n"),
                );
            }
        })();

        return JSON.stringify(
            {
                status: "async_launched",
                agentId,
                description,
                outputFile,
                canReadOutputFile: true,
            },
            null,
            2,
        );
    }

    async readSubAgentOutput({ sessionId, agentId }) {
        if (!agentId) {
            throw new Error("'agent_id' is required");
        }
        const outputFile = this.subAgentOutputPath(sessionId, agentId);
        try {
            return await fsPromises.readFile(outputFile, "utf-8");
        } catch (error) {
            if (error?.code === "ENOENT") {
                return `TaskOutput: no background sub-agent output found for ${agentId}`;
            }
            throw error;
        }
    }

    async sendUserMessage(
        sessionId,
        rawInput,
        images = [],
        atMentions = [],
        userText = null,
        options = {},
    ) {
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
            this.enqueueMessage(sessionId, rawInput, storedImages, normalizedMentions, userText, options);
            return { queued: true };
        }
        await this.dispatchUserMessage(
            sessionId,
            rawInput,
            storedImages,
            normalizedMentions,
            userText,
            options,
        );
        return { queued: false, config: this.configStore.get() };
    }

    async dispatchUserMessage(
        sessionId,
        rawInput,
        storedImages = [],
        atMentions = [],
        userText = null,
        options = {},
    ) {
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
        const computerUseInvoke = parseComputerUseInvocation(input);
        const runId = randomUUID();
        await this.ensureSessionStartHook(sessionId);
        const projectRoot = this.sessionStore.getProjectDirectory(sessionId);
        let messageContent = expandAtMentionsToAbsolute(input, projectRoot);
        if (computerUseInvoke) {
            const agent = this.defaultAgent();
            messageContent = buildComputerUsePrompt(computerUseInvoke.rest, {
                enabled: agent?.tools?.enable_computer_use === true,
            });
        } else if (skillInvoke) {
            messageContent = skillInvoke.rest
                ? expandAtMentionsToAbsolute(skillInvoke.rest, projectRoot)
                : `请按照已加载的 skill「${skillInvoke.skillName}」执行任务。`;
        }
        const promptHook = await this.runUserPromptSubmitHook(sessionId, messageContent);
        if (promptHook.blocked) {
            this.appendHookBlockedAssistant(
                sessionId,
                promptHook.reason || "Prompt blocked by hook",
                runId,
            );
            await this.processQueue(sessionId);
            return;
        }
        if (promptHook.additionalContext) {
            messageContent = `${promptHook.additionalContext}\n\n${messageContent}`;
        }

        const userMessage = {
            id: randomUUID(),
            role: "user",
            content: messageContent,
            createdAt: new Date().toISOString(),
            runId,
            ...(normalizedMentions.length || computerUseInvoke || skillInvoke
                ? {
                      userText: displayText,
                      ...(normalizedMentions.length ? { atMentions: normalizedMentions } : {}),
                  }
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

        await this.runLoop(session, runId);
        await this.processQueue(sessionId);
    }

    async exitPlanMode(sessionId, approvedContent) {
        const { sessionsDir, workspace } = this.resolveSessionPlan(sessionId);
        let { filePath, content } = readPlanFile(sessionsDir, sessionId, workspace);
        if (typeof approvedContent === "string") {
            filePath = writePlanFile(sessionsDir, sessionId, approvedContent, workspace);
            content = approvedContent;
        }
        this.sessionStore.updateExecutionMode(sessionId, "goal");
        await this.sendUserMessage(
            sessionId,
            buildExitPlanModeUserMessage(content, filePath),
            [],
            [],
            null,
        );
        return {
            session: this.sessionStore.get(sessionId),
            planFilePath: filePath,
        };
    }

    async rejectPlanMode(sessionId, { planContent, feedback } = {}) {
        const { sessionsDir, workspace } = this.resolveSessionPlan(sessionId);
        if (typeof planContent === "string") {
            writePlanFile(sessionsDir, sessionId, planContent, workspace);
        }
        const { content } = readPlanFile(sessionsDir, sessionId, workspace);
        const rejectionMessage = {
            id: randomUUID(),
            role: "user",
            content: buildPlanRejectionUserMessage(
                typeof planContent === "string" ? planContent : content,
                feedback,
            ),
            createdAt: new Date().toISOString(),
            planRejection: true,
        };
        let session = this.sessionStore.appendMessage(sessionId, rejectionMessage);
        this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: rejectionMessage });
        this.emit(IPC_CHANNELS.onSessionChanged, session);

        if (this.busyBySession.get(sessionId) || this.pendingQueues.get(sessionId)?.length) {
            return { session, continued: false };
        }

        const runId = randomUUID();
        await this.runLoop(session, runId);
        await this.processQueue(sessionId);
        return {
            session: this.sessionStore.get(sessionId),
            continued: true,
        };
    }

    clearLlmContext(sessionId) {
        let session = this.sessionStore.get(sessionId);
        if (sessionHasActiveLlmContext(session)) {
            const dividerMessage = {
                id: randomUUID(),
                role: CONTEXT_DIVIDER_ROLE,
                content: CONTEXT_DIVIDER_LABEL,
                createdAt: new Date().toISOString(),
            };
            session = this.sessionStore.appendMessage(sessionId, dividerMessage);
            this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: dividerMessage });
            session.meta.llmContextDividerId = dividerMessage.id;
        } else {
            delete session.meta.llmContextDividerId;
        }
        delete session.meta.llmContextFromIndex;
        delete session.meta.contextSummary;
        delete session.meta.postCompactContext;
        delete session.meta.recentFiles;
        delete session.meta.recentSkills;
        session.meta.compactFailures = 0;
        clearSessionMemory(session);
        this.sessionStore.save(session);
        this.emit(IPC_CHANNELS.onSessionChanged, session);
    }

    emitContextWarning(session) {
        const model = this.configStore.model(session.meta.providerKey, session.meta.modelId);
        const state = calculateContextWarningState(session, model, getContextConfig(this.configStore));
        this.emit(IPC_CHANNELS.onContextWarningChanged, {
            sessionId: session.meta.id,
            ...state,
        });
        if (state.isAboveAutoCompactThreshold) {
            this.scheduleAutoCompactIfNeeded(session.meta.id);
        }
    }

    scheduleAutoCompactIfNeeded(sessionId) {
        const contextConfig = getContextConfig(this.configStore);
        if (!contextConfig.auto_compact_enabled || this.compactingSessions.has(sessionId)) {
            return;
        }
        if (this.autoCompactTimers.has(sessionId)) {
            return;
        }

        const session = this.sessionStore.get(sessionId);
        const model = this.configStore.model(session.meta.providerKey, session.meta.modelId);
        if (!shouldAutoCompact(session, model, contextConfig)) {
            return;
        }

        const timer = setTimeout(() => {
            this.autoCompactTimers.delete(sessionId);
            void this.maybeAutoCompact(sessionId);
        }, 300);
        this.autoCompactTimers.set(sessionId, timer);
    }

    recordPersistedToolResult(session, toolCallId, content) {
        if (!toolCallId || !isPersistedToolResultContent(content)) {
            return session;
        }
        const state = loadToolResultBudgetState(session);
        state.seenIds.add(toolCallId);
        state.replacements.set(toolCallId, content);
        session.meta.toolResultBudgetState = serializeToolResultBudgetState(state);
        return session;
    }

    async finalizeToolMessageResult(sessionId, call, result) {
        const tool = this.toolRegistry
            .activeTools(sessionId)
            .find((entry) => entry.name === call.function.name);
        const normalized = normalizeToolResult(result);
        const sessionsDir = this.sessionStore.locateSessionStorage(sessionId);
        return finalizeToolResultForLlm(normalized, {
            toolName: call.function.name,
            toolUseId: call.id,
            maxResultSizeChars: tool ? resolveToolMaxResultSizeChars(tool) : undefined,
            sessionsDir,
            sessionId,
            hasImages: Boolean(normalized.images?.length),
        });
    }

    async applyToolResultBudgetToSession(sessionId) {
        const session = this.sessionStore.get(sessionId);
        const fromIndex = getActiveLlmContextStartIndex(session);
        const activeIndices = [];
        const active = [];
        for (let index = fromIndex; index < session.messages.length; index += 1) {
            const message = session.messages[index];
            if (isContextDividerMessage(message)) {
                continue;
            }
            activeIndices.push(index);
            active.push(message);
        }
        if (!active.length) {
            return session;
        }

        const state = loadToolResultBudgetState(session);
        const skipToolNames = new Set(
            this.toolRegistry
                .activeTools(sessionId)
                .filter((tool) => resolveToolMaxResultSizeChars(tool) === Infinity)
                .map((tool) => tool.name),
        );
        const beforeState = serializeToolResultBudgetState(state);
        const result = await enforceToolResultBudget(active, state, {
            sessionsDir: this.sessionStore.locateSessionStorage(sessionId),
            sessionId,
            skipToolNames,
        });
        const afterState = serializeToolResultBudgetState(state);
        const stateChanged = JSON.stringify(beforeState) !== JSON.stringify(afterState);

        if (result.changed) {
            for (let index = 0; index < active.length; index += 1) {
                session.messages[activeIndices[index]] = result.messages[index];
            }
        }
        if (result.changed || stateChanged) {
            session.meta.toolResultBudgetState = afterState;
            session.meta.updatedAt = new Date().toISOString();
            this.sessionStore.save(session);
            this.emit(IPC_CHANNELS.onSessionChanged, session);
        }
        return session;
    }

    applyMicroCompactIfNeeded(session, modelOverride = null) {
        const contextConfig = getContextConfig(this.configStore);
        const model =
            modelOverride ??
            this.configStore.model(session.meta.providerKey, session.meta.modelId);
        if (!shouldRunMicroCompact(session, model, contextConfig)) {
            return session;
        }

        const fromIndex = getActiveLlmContextStartIndex(session);
        const active = session.messages.slice(fromIndex);
        const { cleared } = microCompactMessagesIfNeeded(active, model, contextConfig);
        if (cleared) {
            session.meta.updatedAt = new Date().toISOString();
            this.sessionStore.save(session);
            this.emit(IPC_CHANNELS.onSessionChanged, session);
        }
        this.emitContextWarning(session);
        return session;
    }

    applyMicroCompact(session) {
        return this.applyMicroCompactIfNeeded(session);
    }

    async maybeAutoCompact(sessionId, signal, runId) {
        if (signal?.aborted || this.isRunCancelled(runId)) {
            return false;
        }
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
            signal,
            runId,
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

    async prepareContextForLlm(sessionId, signal, runId) {
        if (signal?.aborted || this.isRunCancelled(runId)) {
            throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        }
        const contextConfig = getContextConfig(this.configStore);
        let session = this.sessionStore.get(sessionId);
        const model = this.configStore.model(session.meta.providerKey, session.meta.modelId);
        session = await this.applyToolResultBudgetToSession(sessionId);
        session = this.applyMicroCompactIfNeeded(session, model);
        let state = calculateContextWarningState(session, model, contextConfig);
        this.emitContextWarning(session);

        if (!state.isAtBlockingLimit) {
            return { blocked: false, state };
        }

        await this.compactLlmContext(sessionId, {
            auto: true,
            preserveBusy: Boolean(this.busyBySession.get(sessionId)),
            silent: true,
            signal,
            runId,
        });
        session = this.sessionStore.get(sessionId);
        state = calculateContextWarningState(session, model, contextConfig);
        this.emitContextWarning(session);

        if (state.isAtBlockingLimit) {
            return { blocked: true, state };
        }
        return { blocked: false, state };
    }

    async requestAgentLlm(sessionId, invoke, signal, runId) {
        let overflowRetries = 0;

        while (true) {
            if (signal?.aborted || this.isRunCancelled(runId)) {
                throw Object.assign(new Error("Aborted"), { name: "AbortError" });
            }
            const prep = await this.prepareContextForLlm(sessionId, signal, runId);
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
                    signal,
                    runId,
                });
            }
        }
    }

    requestAgentChat(sessionId, chatArgsOrFactory, signal, runId) {
        return this.requestAgentLlm(sessionId, () => {
            const chatArgs =
                typeof chatArgsOrFactory === "function"
                    ? chatArgsOrFactory()
                    : chatArgsOrFactory;
            return this.llmClient.chat(chatArgs);
        }, signal, runId);
    }

    async prepareSubAgentContext(sessionId, messages, model) {
        const contextConfig = getContextConfig(this.configStore);
        const session = this.sessionStore.get(sessionId);
        const state = loadToolResultBudgetState(session);
        const skipToolNames = new Set(
            this.toolRegistry
                .activeTools(sessionId)
                .filter((tool) => resolveToolMaxResultSizeChars(tool) === Infinity)
                .map((tool) => tool.name),
        );
        const beforeState = serializeToolResultBudgetState(state);
        const budgetResult = await enforceToolResultBudget(messages, state, {
            sessionsDir: this.sessionStore.locateSessionStorage(sessionId),
            sessionId,
            skipToolNames,
        });
        const afterState = serializeToolResultBudgetState(state);
        if (budgetResult.changed) {
            messages.splice(0, messages.length, ...budgetResult.messages);
        }
        if (budgetResult.changed || JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
            session.meta.toolResultBudgetState = afterState;
            this.sessionStore.save(session);
        }
        microCompactMessagesIfNeeded(messages, model, contextConfig, { extraTokens: 0 });
        let contextState = calculateMessagesContextWarningState(messages, model, contextConfig);
        this.emitContextWarning(this.sessionStore.get(sessionId));

        if (!contextState.isAtBlockingLimit) {
            return { blocked: false, state: contextState };
        }

        if (shrinkSubAgentMessages(messages, contextConfig)) {
            contextState = calculateMessagesContextWarningState(messages, model, contextConfig);
            if (!contextState.isAtBlockingLimit) {
                return { blocked: false, state: contextState };
            }
        }

        await this.compactLlmContext(sessionId, {
            auto: true,
            preserveBusy: Boolean(this.busyBySession.get(sessionId)),
            silent: true,
        });

        while (shrinkSubAgentMessages(messages, contextConfig)) {
            contextState = calculateMessagesContextWarningState(messages, model, contextConfig);
            if (!contextState.isAtBlockingLimit) {
                return { blocked: false, state: contextState };
            }
        }

        if (contextState.isAtBlockingLimit) {
            return { blocked: true, state: contextState };
        }
        return { blocked: false, state: contextState };
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
            const parsed = parseReadFileResult(toolResultContent(result), args);
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
                getActiveLlmContextStartIndex(session),
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
        const { auto = false, preserveBusy = false, silent = false, signal, runId } = options;
        if (signal?.aborted || this.isRunCancelled(runId)) {
            return;
        }
        if (this.compactingSessions.has(sessionId)) {
            return;
        }
        this.compactingSessions.add(sessionId);
        const manageBusy = !preserveBusy;
        if (manageBusy) {
            this.setBusy(sessionId, true);
        }
        try {
            await this.hookRunner.run(
                "PreCompact",
                this.hookRunner.buildBaseInput(sessionId, "PreCompact", {
                    trigger: auto ? "auto" : "manual",
                }),
                { matchQuery: auto ? "auto" : "manual" },
            );
            const contextConfig = getContextConfig(this.configStore);
            const maxRounds = auto ? MAX_AUTO_COMPACT_ROUNDS : MAX_MANUAL_COMPACT_ROUNDS;
            let totalSummarized = 0;
            let lastKeepLength = 0;
            let roundsCompleted = 0;

            for (let round = 0; round < maxRounds; round += 1) {
                if (signal?.aborted || this.isRunCancelled(runId)) {
                    return;
                }

                let session = this.sessionStore.get(sessionId);
                const entries = getActiveLlmContextEntries(session);
                let activeMessages = entries.map((entry) => entry.message);
                const model = this.configStore.model(session.meta.providerKey, session.meta.modelId);
                const contextState = calculateContextWarningState(session, model, contextConfig);
                const compactConfig = mergeCompactKeepSettings(
                    contextConfig,
                    resolveCompactKeepSettings(contextState, contextConfig),
                );
                const needsForcedSplit =
                    contextState.isAboveAutoCompactThreshold || contextState.isAtBlockingLimit;

                preCompactMicroCompact(activeMessages, compactConfig);
                this.sessionStore.save(session);

                let { toSummarize, keep, keepStartIndex } = splitMessagesForCompact(
                    activeMessages,
                    compactConfig,
                );

                if (!toSummarize.length && needsForcedSplit) {
                    ({ toSummarize, keep, keepStartIndex } = splitMessagesForCompact(
                        activeMessages,
                        compactConfig,
                        { minMessages: 2, forceSplit: true },
                    ));
                }

                if (!toSummarize.length) {
                    if (round === 0 && !auto) {
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
                    break;
                }

                if (
                    round > 0 &&
                    toSummarize.length <= 1 &&
                    keep.length >= lastKeepLength &&
                    roundsCompleted > 0
                ) {
                    break;
                }
                lastKeepLength = keep.length;

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
                        compactConfig,
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
                        signal,
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

                session = this.sessionStore.get(sessionId);
                const sessionKeepIndex = entries[keepStartIndex]?.index ?? entries[0]?.index ?? 0;
                const postCompactContext =
                    buildPostCompactContext(session, compactConfig) || undefined;
                const dividerMessage = {
                    id: randomUUID(),
                    role: CONTEXT_DIVIDER_ROLE,
                    content: CONTEXT_COMPACT_DIVIDER_LABEL,
                    contextSummary: summary,
                    ...(postCompactContext ? { postCompactContext } : {}),
                    createdAt: new Date().toISOString(),
                };
                session.messages.splice(sessionKeepIndex, 0, dividerMessage);
                session.meta.llmContextDividerId = dividerMessage.id;
                delete session.meta.llmContextFromIndex;
                session.meta.contextSummary = summary;
                session.meta.postCompactContext = postCompactContext;
                if (!session.meta.postCompactContext) {
                    delete session.meta.postCompactContext;
                }
                session.meta.compactFailures = 0;
                session.meta.updatedAt = new Date().toISOString();
                const lastSummarizedIndex =
                    entries[keepStartIndex - 1]?.index ?? sessionKeepIndex - 1;
                syncSessionMemoryAfterCompact(session, summary, lastSummarizedIndex);
                this.sessionStore.save(session);
                this.emit(IPC_CHANNELS.onSessionChanged, session);
                this.emitContextWarning(session);

                totalSummarized += toSummarize.length;
                roundsCompleted += 1;

                const afterState = calculateContextWarningState(
                    this.sessionStore.get(sessionId),
                    model,
                    contextConfig,
                );
                if (!afterState.isAboveAutoCompactThreshold && !afterState.isAtBlockingLimit) {
                    break;
                }
            }

            if (roundsCompleted === 0) {
                return;
            }

            session = this.sessionStore.get(sessionId);
            const model = this.configStore.model(session.meta.providerKey, session.meta.modelId);
            if (!silent) {
                const afterState = calculateContextWarningState(session, model, contextConfig);
                const restoredNote = session.meta.postCompactContext
                    ? "，并恢复了最近读取的文件/技能摘要"
                    : "";
                const roundsNote =
                    roundsCompleted > 1 ? `（共 ${roundsCompleted} 轮）` : "";
                const percentNote =
                    afterState.percent >= 100
                        ? `；当前仍约 ${afterState.percent}%，可再次 /compact 或 /clear_context`
                        : `；当前约 ${afterState.percent}%`;
                const feedback = withAssistantModel(
                    {
                        id: randomUUID(),
                        role: "assistant",
                        content: auto
                            ? `[自动压缩] 已将 ${totalSummarized} 条较早消息压缩为结构化摘要${roundsNote}${restoredNote}${percentNote}。`
                            : `已压缩 ${totalSummarized} 条较早消息为结构化摘要${roundsNote}${restoredNote}${percentNote}。`,
                        createdAt: new Date().toISOString(),
                    },
                    { modelId: session.meta.modelId },
                );
                session = this.sessionStore.appendMessage(sessionId, feedback);
                this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: feedback });
                this.emit(IPC_CHANNELS.onSessionChanged, session);
            }

            await this.hookRunner.run(
                "PostCompact",
                this.hookRunner.buildBaseInput(sessionId, "PostCompact", {
                    trigger: auto ? "auto" : "manual",
                }),
                { matchQuery: auto ? "auto" : "manual" },
            );
        } catch (error) {
            if (error?.name === "AbortError" || this.isRunCancelled(runId)) {
                return;
            }
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
        this.activeRunIdBySession.set(sessionId, runId);
        this.setBusy(sessionId, true);
        const abortController = this.createAbortSignal(sessionId);
        const signal = abortController.signal;
        const runStartedAt = Date.now();
        try {
            const agent = this.defaultAgent();
            const maxRounds = Math.max(1, agent?.max_tool_rounds ?? 8);
            const toolsEnabled = agent?.tools?.enable_tools !== false;
            const unlockedToolNames = new Set();
            let round = 0;
            const computerActionHistory = [];
            await this.logInfo("agent.run.start", {
                sessionId,
                runId,
                maxRounds,
                toolsEnabled,
                providerKey: session.meta.providerKey,
                modelId: session.meta.modelId,
            });

            while (round < maxRounds) {
                if (this.wasRunCancelled(runId)) {
                    return;
                }
                const planMode = this.sessionExecutionMode(sessionId) === "plan";
                const planFilePath = planMode
                    ? this.resolveSessionPlan(sessionId).filePath
                    : null;
                session = this.sessionStore.get(sessionId);
                session = this.applyMicroCompact(session);
                if (this.wasRunCancelled(runId)) {
                    return;
                }
                await this.maybeAutoCompact(sessionId, signal, runId);
                if (this.wasRunCancelled(runId)) {
                    return;
                }
                session = this.sessionStore.get(sessionId);
                const model = {
                    providerKey: session.meta.providerKey,
                    modelId: session.meta.modelId,
                };
                let toolSchemas = [];
                if (toolsEnabled) {
                    if (planMode) {
                        toolSchemas = this.toolRegistry.schemas({
                            tools: filterToolsForPlanMode(
                                this.toolRegistry.activeTools(sessionId),
                            ),
                            unlockedToolNames,
                        });
                    } else {
                        toolSchemas = this.toolRegistry.schemas({
                            unlockedToolNames,
                            sessionId,
                            tools: filterToolsForLatestUserIntent(
                                this.toolRegistry.activeTools(sessionId),
                                latestUserText(session),
                            ),
                        });
                    }
                }
                await this.logInfo("agent.run.round.start", {
                    sessionId,
                    runId,
                    round: round + 1,
                    maxRounds,
                    planMode,
                    toolSchemaCount: toolSchemas.length,
                    providerKey: model.providerKey,
                    modelId: model.modelId,
                });
                const chatResult = await this.requestAgentChat(
                    sessionId,
                    () => {
                        const refreshedSession = this.sessionStore.get(sessionId);
                        return {
                            messages: this.messagesForLLM(refreshedSession),
                            model,
                            modelChain: this.modelChainForSession(refreshedSession),
                            tools: toolSchemas,
                            signal,
                        };
                    },
                    signal,
                    runId,
                );
                if (this.wasRunCancelled(runId)) {
                    return;
                }
                if (chatResult.blocked) {
                    await this.logWarn("agent.run.finish", {
                        sessionId,
                        runId,
                        reason: "context_blocked",
                        percent: chatResult.state?.percent,
                        durationMs: Date.now() - runStartedAt,
                    });
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
                await this.logInfo("agent.llm.response", {
                    sessionId,
                    runId,
                    round: round + 1,
                    assistantMessageId: assistant.id,
                    toolCallCount: assistant.toolCalls?.length || 0,
                    contentChars: String(assistant.content || "").length,
                    usedFallback: Boolean(choice.usedFallback),
                    usedProviderKey: usedModel.providerKey,
                    usedModelId: usedModel.modelId,
                    usage: choice.usage,
                });
                if (choice.usedFallback && choice.usedModel) {
                    const note = `(已自动切换至备用模型 ${choice.usedModel.providerKey}/${choice.usedModel.modelId})\n\n`;
                    assistant = { ...assistant, content: `${note}${assistant.content || ""}` };
                }
                session = this.sessionStore.appendMessage(session.meta.id, assistant);
                this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: assistant });
                this.emit(IPC_CHANNELS.onSessionChanged, session);

                const calls = assistant.toolCalls || [];
                if (!calls.length) {
                    const stopHook = await this.runStopHook(
                        sessionId,
                        String(assistant.content || ""),
                        signal,
                    );
                    if (stopHook.systemMessage) {
                        const notice = withAssistantModel(
                            {
                                id: randomUUID(),
                                role: "assistant",
                                content: stopHook.systemMessage,
                                createdAt: new Date().toISOString(),
                                runId,
                            },
                            { modelId: session.meta.modelId },
                        );
                        session = this.sessionStore.appendMessage(sessionId, notice);
                        this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: notice });
                        this.emit(IPC_CHANNELS.onSessionChanged, session);
                    }
                    await this.logInfo("agent.run.finish", {
                        sessionId,
                        runId,
                        reason: "assistant_message",
                        rounds: round + 1,
                        durationMs: Date.now() - runStartedAt,
                    });
                    void this.refreshSessionMemory(sessionId);
                    return;
                }

                for (const call of calls) {
                    if (this.wasRunCancelled(runId)) {
                        return;
                    }
                    const result = await this.executeToolWithHooks(
                        call,
                        {
                            sessionId,
                            sessionsDir: this.sessionStore.locateSessionStorage(sessionId),
                            runId,
                            unlockedToolNames,
                            planMode,
                            planFilePath,
                            executionMode: planMode ? "plan" : "goal",
                            signal,
                        },
                        signal,
                    );
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
                    const normalized = await this.finalizeToolMessageResult(sessionId, call, result);
                    let toolContent = normalized.content;
                    const fingerprint = computerActionFingerprint(call);
                    if (fingerprint) {
                        computerActionHistory.push(fingerprint);
                        if (computerActionHistory.length > 5) {
                            computerActionHistory.shift();
                        }
                        const recent = computerActionHistory.slice(-3);
                        if (
                            recent.length === 3 &&
                            recent.every((entry) => entry === recent[0])
                        ) {
                            toolContent += formatComputerLoopNudge(3);
                        }
                    }
                    const toolMessage = {
                        id: randomUUID(),
                        role: "tool",
                        name: call.function.name,
                        toolCallId: call.id,
                        content: toolContent,
                        ...(normalized.images ? { images: normalized.images } : {}),
                        createdAt: new Date().toISOString(),
                        runId,
                    };
                    session = this.sessionStore.appendMessage(sessionId, toolMessage);
                    session = this.recordPersistedToolResult(
                        session,
                        call.id,
                        toolContent,
                    );
                    if (session.meta.toolResultBudgetState) {
                        this.sessionStore.save(session);
                    }
                    this.emit(IPC_CHANNELS.onMessageAppended, { sessionId, message: toolMessage });
                    this.emit(IPC_CHANNELS.onSessionChanged, session);
                    session = this.trackToolSideEffects(session, call, normalized);
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
            await this.logWarn("agent.run.finish", {
                sessionId,
                runId,
                reason: "tool_round_limit",
                rounds: maxRounds,
                durationMs: Date.now() - runStartedAt,
            });
        } catch (error) {
            if (error?.name === "AbortError" || this.isRunCancelled(runId)) {
                this.cancelledRunIds.delete(runId);
                await this.logWarn("agent.run.finish", {
                    sessionId,
                    runId,
                    reason: "aborted",
                    durationMs: Date.now() - runStartedAt,
                });
                return;
            }
            await this.logError("agent.run.error", {
                sessionId,
                runId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                durationMs: Date.now() - runStartedAt,
            });
            this.emit(IPC_CHANNELS.onError, {
                sessionId,
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.cancelledRunIds.delete(runId);
            if (this.activeRunIdBySession.get(sessionId) === runId) {
                this.activeRunIdBySession.delete(sessionId);
                this.clearAbortSignal(sessionId, abortController);
                this.setBusy(sessionId, false);
            }
        }
    }
}
