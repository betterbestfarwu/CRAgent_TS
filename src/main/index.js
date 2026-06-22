import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { applyAppIcon } from "./appIcon.js";
import { IPC_CHANNELS } from "@shared/ipc";
import { DEFAULT_UI_MESSAGE_PAGE } from "@shared/sessionPaging.js";
import { resolveLlmRequestTimeoutMs, resolveLlmTemperature } from "@shared/uiConfig.js";
import { getAppPaths } from "./appPaths";
import { ConfigStore } from "./configStore";
import { SessionStore } from "./sessionStore";
import { LlmClient } from "./llmClient";
import { ToolRegistry } from "./toolRegistry";
import { AgentRuntime } from "./agentRuntime";
import { WorkspaceMemory } from "./workspaceMemory.js";
import { SkillLoader } from "./skillLoader.js";
import { resolveSessionWorkspace, resolveWorkspace } from "./workspacePaths.js";
import { sessionForRenderer } from "./rendererSession.js";
import { createBuiltinTools } from "./tools/builtinTools.js";
import { createMetaTools } from "./tools/metaTools.js";
import { McpManager } from "./mcp/mcpManager.js";
import { createMcpTools } from "./mcp/mcpTools.js";
import { mcpToolRegistryName } from "@shared/mcpConfig.js";
import {
    applyProviderConnection,
    validateProviderConnectionFields,
} from "@shared/providerConnection.js";
import { fetchProviderModelIds, mergeProviderModels } from "./modelSyncService.js";
import { createToolConfirmFn, registerConfirmBridge } from "./confirmBridge.js";
import { registerPlanApprovalBridge, requestPlanApproval } from "./planApprovalBridge.js";
import { readPlanApprovalDraft, getPlanDisplayPath, readPlanFile, writePlanFile } from "./planMode.js";
import { createPlanModeTools } from "./tools/planModeTools.js";
import { createComputerUseTools } from "./tools/computerUseTools.js";
import fs from "node:fs";
import { normalizeAuthMode } from "@shared/authMode.js";
import { resolveWindowChrome } from "@shared/windowChrome.js";
import { listProjectDirectory } from "./projectBrowse.js";
import { getFileIconsAsDataUrls } from "./fileIcons.js";
import { legacySessionFile, metaFile, sessionDir } from "./sessionStorage.js";
import {
    registerSessionImageProtocol,
    registerSessionImageScheme,
} from "./sessionImageProtocol.js";
import { createDiagnosticLogger } from "./diagnosticLogger.js";

const devServerUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL;
/** Packaged builds must always load bundled renderer, even if shell env has NODE_ENV=development. */
const isDev =
    !app.isPackaged &&
    (Boolean(devServerUrl) || process.env.NODE_ENV === "development");

let mainWindow = null;
let configStore;
let sessionStore;
let runtime;
let skillLoader;
let mcpManager;
let diagnosticLogger;

function windowChromeOptions() {
    if (process.platform === "darwin") {
        return {
            titleBarStyle: "hiddenInset",
            trafficLightPosition: { x: 14, y: 12 },
        };
    }
    if (process.platform === "win32") {
        return {
            titleBarStyle: "hidden",
            titleBarOverlay: resolveWindowChrome("light").titleBarOverlay,
        };
    }
    return {};
}

function applyWindowChrome(win, colorScheme) {
    if (!win || win.isDestroyed()) {
        return;
    }
    const chrome = resolveWindowChrome(colorScheme);
    win.setBackgroundColor(chrome.backgroundColor);
    if (process.platform === "win32") {
        win.setTitleBarOverlay(chrome.titleBarOverlay);
    }
}

function attachEditableContextMenu(webContents) {
    webContents.on("context-menu", (_event, params) => {
        if (!params.isEditable) return;

        const template = [
            { role: "cut", label: "剪切", enabled: params.editFlags.canCut },
            { role: "copy", label: "复制", enabled: params.editFlags.canCopy },
            { role: "paste", label: "粘贴", enabled: params.editFlags.canPaste },
            { type: "separator" },
            { role: "selectAll", label: "全选", enabled: params.editFlags.canSelectAll },
        ];
        Menu.buildFromTemplate(template).popup({
            window: BrowserWindow.fromWebContents(webContents) ?? undefined,
        });
    });
}

function createWindow() {
    const icon = applyAppIcon();
    mainWindow = new BrowserWindow({
        width: 1240,
        height: 820,
        minWidth: 900,
        minHeight: 640,
        title: "CRAgent",
        backgroundColor: "#f3f3f3",
        ...windowChromeOptions(),
        ...(icon ? { icon } : {}),
        webPreferences: {
            preload: path.join(__dirname, "../preload/index.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    attachEditableContextMenu(mainWindow.webContents);
    mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
        console.error("[CRAgent] did-fail-load", code, desc, url);
    });
    const pageUrl =
        isDev && devServerUrl
            ? devServerUrl
            : isDev
              ? "http://localhost:5173/"
              : path.join(__dirname, "../renderer/index.html");
    if (isDev) {
        void mainWindow.loadURL(pageUrl);
        if (process.env.CRAGENT_DEVTOOLS === "1") {
            mainWindow.webContents.openDevTools({ mode: "detach" });
        }
    } else {
        void mainWindow.loadFile(pageUrl);
    }
}

function buildMenu() {
    const template = [
        {
            label: "CRAgent",
            submenu: [
                { role: "about" },
                {
                    label: "Settings…",
                    accelerator: "CmdOrCtrl+,",
                    click: () => {
                        mainWindow?.webContents.send("ui:openSettings");
                    },
                },
                { type: "separator" },
                { role: "quit", label: "Quit CRAgent" },
            ],
        },
        {
            label: "File",
            submenu: [
                {
                    label: "New Chat",
                    accelerator: "CmdOrCtrl+N",
                    click: () => {
                        const session = sessionStore.openNewSession();
                        mainWindow?.webContents.send(
                            IPC_CHANNELS.onSessionChanged,
                            sessionForRenderer(session),
                        );
                    },
                },
            ],
        },
        {
            label: "Edit",
            submenu: [
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
    ipcMain.handle(IPC_CHANNELS.getSnapshot, () => {
        const sessions = sessionStore.listMetas();
        return {
            projects: sessionStore.listProjects(),
            sessions,
            currentSessionId: sessions[0]?.id ?? "",
            config: configStore.get(),
        };
    });
    ipcMain.handle(IPC_CHANNELS.openConfigFile, async () => {
        const filePath = configStore.filePath;
        const error = await shell.openPath(filePath);
        if (error) {
            throw new Error(error);
        }
        return { ok: true, filePath };
    });
    ipcMain.handle(IPC_CHANNELS.getFileIcons, async (_event, paths) =>
        getFileIconsAsDataUrls(Array.isArray(paths) ? paths : []),
    );
    ipcMain.handle(IPC_CHANNELS.listSkills, () => skillLoader.listSummaries());
    ipcMain.handle(IPC_CHANNELS.listProjects, () => sessionStore.listProjects());
    ipcMain.handle(IPC_CHANNELS.addProject, (_event, directoryPath) =>
        sessionStore.addProject(directoryPath),
    );
    ipcMain.handle(IPC_CHANNELS.removeProject, (_event, projectId) => {
        const result = sessionStore.removeProject(projectId);
        for (const sessionId of result.deletedSessionIds || []) {
            runtime.cancelRun(sessionId);
            runtime.clearHookLogs(sessionId);
        }
        return result;
    });
    ipcMain.handle(IPC_CHANNELS.pickProjectDirectory, async () => {
        const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
            title: "选择项目目录",
            properties: ["openDirectory", "createDirectory"],
        });
        if (result.canceled || !result.filePaths?.length) {
            return null;
        }
        return result.filePaths[0];
    });
    ipcMain.handle(IPC_CHANNELS.openProjectDirectory, async (_event, projectId) => {
        const id = String(projectId || "").trim();
        if (!id) {
            throw new Error("缺少 projectId");
        }
        const project = sessionStore.listProjects().find((item) => item.id === id);
        if (!project?.directoryPath) {
            throw new Error("未找到项目");
        }
        const error = await shell.openPath(project.directoryPath);
        if (error) {
            throw new Error(error);
        }
        return { ok: true, directoryPath: project.directoryPath };
    });
    ipcMain.handle(IPC_CHANNELS.listProjectDirectory, async (_event, args = {}) => {
        const projectId = String(args.projectId || "").trim();
        const relativePath = String(args.relativePath || "");
        const searchFilter = String(args.searchFilter || "");
        if (!projectId) {
            throw new Error("缺少 projectId");
        }
        const project = sessionStore.listProjects().find((item) => item.id === projectId);
        if (!project?.directoryPath) {
            throw new Error("未找到项目");
        }
        return listProjectDirectory(project.directoryPath, relativePath, searchFilter);
    });
    ipcMain.handle(IPC_CHANNELS.getSession, (_event, sessionId, options = {}) =>
        sessionForRenderer(
            sessionStore.get(sessionId, { hydrateImages: false, ...options }),
        ),
    );
    ipcMain.handle(IPC_CHANNELS.getSessionImage, (_event, args = {}) =>
        sessionStore.getMessageImage(
            args.sessionId,
            args.messageId,
            args.imageIndex,
            args.imageFile,
            args.mimeType,
        ),
    );
    ipcMain.handle(IPC_CHANNELS.getSessionContextDetail, (_event, sessionId) =>
        runtime.getSessionContextDetail(sessionId),
    );
    ipcMain.handle(IPC_CHANNELS.newSession, (_event, args = {}) => {
        const config = configStore.get();
        const defaultExecutionMode =
            config.agents?.default?.execution_mode === "plan" ? "plan" : "goal";
        return sessionForRenderer(
            sessionStore.openNewSession({
                ...args,
                executionMode: defaultExecutionMode,
            }),
        );
    });
    ipcMain.handle(IPC_CHANNELS.deleteSession, (_event, sessionId) => {
        const fallbackMeta = sessionStore.delete(sessionId);
        return sessionForRenderer(
            sessionStore.get(fallbackMeta.id, {
                hydrateImages: false,
                messageLimit: DEFAULT_UI_MESSAGE_PAGE,
            }),
        );
    });
    ipcMain.handle(IPC_CHANNELS.openSessionDirectory, async (_event, sessionId) => {
        const id = String(sessionId || "").trim();
        if (!id) {
            throw new Error("缺少 sessionId");
        }
        const sessionsDir = sessionStore.locateSessionStorage(id);
        const metaPath = metaFile(sessionsDir, id);
        const legacyPath = legacySessionFile(sessionsDir, id);
        const revealPath = fs.existsSync(metaPath)
            ? metaPath
            : fs.existsSync(legacyPath)
              ? legacyPath
              : sessionDir(sessionsDir, id);
        shell.showItemInFolder(revealPath);
        return { ok: true, directoryPath: sessionDir(sessionsDir, id) };
    });
    ipcMain.handle(IPC_CHANNELS.deleteMessages, (_event, args) => {
        const session = sessionStore.removeMessages(args.sessionId, args.messageIds);
        mainWindow?.webContents.send(
            IPC_CHANNELS.onSessionChanged,
            sessionForRenderer(session),
        );
        return sessionForRenderer(session);
    });
    ipcMain.handle(IPC_CHANNELS.forkSession, (_event, args) => {
        const session = sessionStore.forkSession(args.sessionId, args.messageId);
        return sessionForRenderer(session);
    });
    ipcMain.handle(IPC_CHANNELS.sendChat, (_event, request) =>
        runtime.sendUserMessage(
            request.sessionId,
            request.userInput,
            request.images,
            request.atMentions,
            request.userText,
        ),
    );
    ipcMain.handle(IPC_CHANNELS.exitPlanMode, async (_event, sessionId) => {
        const sessionsDir = sessionStore.locateSessionStorage(sessionId);
        const workspace = resolveSessionWorkspace(sessionStore, configStore, sessionId);
        const draft = readPlanApprovalDraft(sessionsDir, sessionId, workspace);
        const approval = await requestPlanApproval(mainWindow, draft);
        if (approval.dismissed || approval.cancelled) {
            return { dismissed: true };
        }
        if (approval.rejected || !approval.approved) {
            const rejected = await runtime.rejectPlanMode(sessionId, {
                planContent: approval.content ?? draft.content,
                feedback: approval.feedback,
            });
            return { rejected: true, session: sessionForRenderer(rejected.session) };
        }
        return runtime.exitPlanMode(sessionId, approval.content);
    });
    ipcMain.handle(IPC_CHANNELS.openPlanFile, async (_event, sessionId) => {
        const sessionsDir = sessionStore.locateSessionStorage(sessionId);
        const workspace = resolveSessionWorkspace(sessionStore, configStore, sessionId);
        let { filePath } = readPlanFile(sessionsDir, sessionId, workspace);
        if (!fs.existsSync(filePath)) {
            filePath = writePlanFile(sessionsDir, sessionId, "# Plan\n\n", workspace);
        }
        const error = await shell.openPath(filePath);
        if (error) {
            throw new Error(error);
        }
        return { filePath };
    });
    ipcMain.handle(IPC_CHANNELS.readPlanContent, (_event, sessionId) => {
        const sessionsDir = sessionStore.locateSessionStorage(sessionId);
        const workspace = resolveSessionWorkspace(sessionStore, configStore, sessionId);
        const { content } = readPlanFile(sessionsDir, sessionId, workspace);
        return {
            content: content ?? "",
            displayPath: getPlanDisplayPath(),
        };
    });
    ipcMain.handle(IPC_CHANNELS.cancelRun, (_event, sessionId) => runtime.cancelRun(sessionId));
    ipcMain.handle(IPC_CHANNELS.getHookLogs, (_event, sessionId) => runtime.getHookLogs(sessionId));
    ipcMain.handle(IPC_CHANNELS.clearHookLogs, (_event, sessionId) => {
        runtime.clearHookLogs(sessionId);
    });
    ipcMain.handle(IPC_CHANNELS.removeQueuedMessage, (_event, args) =>
        runtime.removeQueuedMessage(args.sessionId, args.messageId),
    );
    ipcMain.handle(IPC_CHANNELS.reorderQueuedMessages, (_event, args) =>
        runtime.reorderQueuedMessages(args.sessionId, args.fromIndex, args.toIndex),
    );
    ipcMain.handle(IPC_CHANNELS.updateAuthMode, (_event, args) => {
        const session = sessionStore.updateAuthMode(args.sessionId, args.authMode);
        mainWindow?.webContents.send(
            IPC_CHANNELS.onSessionChanged,
            sessionForRenderer(session),
        );
        return sessionForRenderer(session);
    });
    ipcMain.handle(IPC_CHANNELS.updateExecutionMode, (_event, args) => {
        const session = sessionStore.updateExecutionMode(args.sessionId, args.executionMode);
        mainWindow?.webContents.send(
            IPC_CHANNELS.onSessionChanged,
            sessionForRenderer(session),
        );
        return sessionForRenderer(session);
    });
    ipcMain.handle(IPC_CHANNELS.updateSessionProject, (_event, args) => {
        const session = sessionStore.updateProject(args.sessionId, args.projectId);
        mainWindow?.webContents.send(
            IPC_CHANNELS.onSessionChanged,
            sessionForRenderer(session),
        );
        return sessionForRenderer(session);
    });
    ipcMain.handle(IPC_CHANNELS.updateModel, (_event, args) => {
        const session = sessionStore.updateModel(args.sessionId, args.providerKey, args.modelId);
        mainWindow?.webContents.send(
            IPC_CHANNELS.onSessionChanged,
            sessionForRenderer(session),
        );
    });
    ipcMain.handle(IPC_CHANNELS.updateConfig, async (_event, next) => {
        const updated = configStore.update(next);
        if (mcpManager) {
            try {
                await mcpManager.refresh();
            } catch (error) {
                console.error("[CRAgent] MCP refresh after config save failed:", error);
            }
        }
        return updated;
    });
    ipcMain.handle(IPC_CHANNELS.getMcpStatus, () => ({
        toolCount: mcpManager?.getToolCount() ?? 0,
        errors: mcpManager?.getServerErrors() ?? {},
    }));
    ipcMain.handle(IPC_CHANNELS.probeMcp, async (_event, mcpSlice) => {
        const probeManager = new McpManager(() => ({
            mcp: { ...mcpSlice, enabled: true },
        }));
        try {
            const entries = await probeManager.refresh();
            return {
                ok: true,
                toolCount: entries.length,
                tools: entries.map(({ serverId, tool }) => ({
                    serverId,
                    name: tool.name,
                    registryName: mcpToolRegistryName(serverId, tool.name),
                })),
                errors: probeManager.getServerErrors(),
            };
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            await probeManager.closeAll();
        }
    });
    ipcMain.handle(IPC_CHANNELS.syncColorScheme, (_event, colorScheme) => {
        applyWindowChrome(mainWindow, colorScheme === "dark" ? "dark" : "light");
        return { ok: true };
    });
    ipcMain.handle(IPC_CHANNELS.syncProviderModels, async (_event, args) => {
        const providerKey = args?.providerKey;
        const connection = args?.connection;
        const draftModels = args?.models;
        if (!providerKey) {
            return { ok: false, error: "缺少 providerKey" };
        }
        if (draftModels && typeof draftModels === "object") {
            configStore.update({
                ...configStore.get(),
                models: draftModels,
            });
        }
        const existing = configStore.get().models?.[providerKey];
        if (!existing) {
            return { ok: false, error: `未找到 provider: ${providerKey}` };
        }
        const validation = validateProviderConnectionFields(connection);
        if (!validation.ok) {
            return { ok: false, error: validation.error };
        }
        const provider = applyProviderConnection(existing, connection);
        configStore.updateProvider(providerKey, provider);
        try {
            const remoteIds = await fetchProviderModelIds(provider);
            const mergedProvider = mergeProviderModels(provider, remoteIds);
            const syncedConfig = configStore.updateProvider(providerKey, mergedProvider);
            return {
                ok: true,
                providerKey,
                count: mergedProvider.models.length,
                config: syncedConfig,
                synced: true,
            };
        } catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    });
}

function bootstrap() {
    registerConfirmBridge();
    registerPlanApprovalBridge();
    const appPaths = getAppPaths();
    diagnosticLogger = createDiagnosticLogger(appPaths.logDir);
    void diagnosticLogger.info("app.bootstrap", {
        root: appPaths.root,
        logDir: appPaths.logDir,
        isPackaged: app.isPackaged,
        isDev,
    });
    configStore = new ConfigStore(appPaths.configFile);
    const getDefaultWorkspace = () => resolveWorkspace(configStore);
    const getAgentWorkspace = (sessionId) =>
        resolveSessionWorkspace(sessionStore, configStore, sessionId);
    const workspaceMemory = new WorkspaceMemory(getDefaultWorkspace, appPaths.memoryDir);
    workspaceMemory.bootstrapIfNeeded();

    skillLoader = new SkillLoader(appPaths.skillsDir);
    skillLoader.bootstrapIfNeeded();

    const getAgentTools = () => {
        const agent =
            configStore.get().agents.list.find((entry) => entry.is_default) ||
            configStore.get().agents.list[0];
        return agent?.tools || { enable_tools: true, enable_file_tools: true, enable_skills: true };
    };

    sessionStore = new SessionStore(
        appPaths.sessionsDir,
        () => configStore.resolvePrimaryRef(),
        appPaths.projectsFile,
        appPaths.projectsDir,
    );

    const getAuthMode = (sessionId) => {
        try {
            const session = sessionStore.get(sessionId);
            return normalizeAuthMode(session.meta.authMode);
        } catch {
            return "default";
        }
    };

    const baseConfirm = createToolConfirmFn(() => mainWindow);

    mcpManager = new McpManager(() => configStore.get());
    const buildMcpTools = createMcpTools({
        mcpManager,
        getAgentTools,
        getConfig: () => configStore.get(),
    });
    void mcpManager.refresh().catch((error) => {
        console.error("[CRAgent] MCP refresh failed:", error);
    });

    const toolRegistry = new ToolRegistry(
        () => {
            const builtin = createBuiltinTools({
                getAgentWorkspace,
                getDefaultWorkspace,
                workspaceMemory,
                skillLoader,
                getAgentTools,
                confirmToolExecution: baseConfirm,
                getAuthMode,
            });
            const meta = createMetaTools({
                getAgentTools,
                updateTodos: (sessionId, todos, merge, runId) =>
                    runtime.updateTodos(sessionId, todos, merge, runId),
                runSubAgent: (args) => runtime.runSubAgent(args),
                runSubAgentInBackground: (args) => runtime.runSubAgentInBackground(args),
                readSubAgentOutput: (args) => runtime.readSubAgentOutput(args),
            });
            const planTools = createPlanModeTools({
                sessionStore,
                resolveWorkspaceForSession: (sessionId) =>
                    resolveSessionWorkspace(sessionStore, configStore, sessionId),
            });
            const computerTools = createComputerUseTools({
                getAgentTools,
                confirmToolExecution: baseConfirm,
                getAuthMode,
            });
            return [...builtin, ...buildMcpTools(), ...meta, ...planTools, ...computerTools];
        },
        baseConfirm,
        getAuthMode,
    );

    const llmClient = new LlmClient((providerKey) => configStore.get().models[providerKey], {
        onTokenUsage: (model, usage) =>
            configStore.recordModelTokenUsage(model.providerKey, model.modelId, usage),
        resolveRequestTimeoutMs: () =>
            resolveLlmRequestTimeoutMs(configStore.get().ui),
        resolveTemperature: () => resolveLlmTemperature(configStore.get().ui),
        diagnosticLogger,
    });
    runtime = new AgentRuntime(
        sessionStore,
        configStore,
        llmClient,
        toolRegistry,
        workspaceMemory,
        skillLoader,
        () => mainWindow,
        diagnosticLogger,
    );
    registerIpc();
}

registerSessionImageScheme();

app.whenReady().then(() => {
    applyAppIcon();
    bootstrap();
    registerSessionImageProtocol((sessionId) => sessionStore.locateSessionStorage(sessionId));
    createWindow();
    buildMenu();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("will-quit", () => {
    void mcpManager?.closeAll();
});
