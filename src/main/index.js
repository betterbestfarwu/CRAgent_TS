import { app, BrowserWindow, Menu, ipcMain } from "electron";
import path from "node:path";
import { applyAppIcon } from "./appIcon.js";
import { IPC_CHANNELS } from "@shared/ipc";
import { getAppPaths } from "./appPaths";
import { ConfigStore } from "./configStore";
import { SessionStore } from "./sessionStore";
import { LlmClient } from "./llmClient";
import { ToolRegistry } from "./toolRegistry";
import { AgentRuntime } from "./agentRuntime";
import { WorkspaceMemory } from "./workspaceMemory.js";
import { SkillLoader } from "./skillLoader.js";
import { resolveWorkspace } from "./workspacePaths.js";
import { createBuiltinTools } from "./tools/builtinTools.js";
import { fetchProviderModelIds, mergeProviderModels } from "./modelSyncService.js";

const devServerUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL;
const isDev = Boolean(devServerUrl) || process.env.NODE_ENV === "development";

let mainWindow = null;
let configStore;
let sessionStore;
let runtime;
let skillLoader;

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
            titleBarOverlay: {
                color: "#f3f3f3",
                symbolColor: "#141414",
                height: 40,
            },
        };
    }
    return {};
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
            sandbox: true,
        },
    });
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
        mainWindow.webContents.openDevTools({ mode: "detach" });
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
                        mainWindow?.webContents.send(IPC_CHANNELS.onSessionChanged, session);
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
            sessions,
            currentSessionId: sessions[0]?.id ?? "",
            config: configStore.get(),
        };
    });
    ipcMain.handle(IPC_CHANNELS.listSkills, () => skillLoader.listSummaries());
    ipcMain.handle(IPC_CHANNELS.getSession, (_event, sessionId) => sessionStore.get(sessionId));
    ipcMain.handle(IPC_CHANNELS.newSession, () => sessionStore.openNewSession());
    ipcMain.handle(IPC_CHANNELS.deleteSession, (_event, sessionId) => {
        const fallbackMeta = sessionStore.delete(sessionId);
        return sessionStore.get(fallbackMeta.id);
    });
    ipcMain.handle(IPC_CHANNELS.deleteMessages, (_event, args) => {
        const session = sessionStore.removeMessages(args.sessionId, args.messageIds);
        mainWindow?.webContents.send(IPC_CHANNELS.onSessionChanged, session);
        return session;
    });
    ipcMain.handle(IPC_CHANNELS.sendChat, (_event, request) =>
        runtime.sendUserMessage(request.sessionId, request.userInput, request.images),
    );
    ipcMain.handle(IPC_CHANNELS.updateModel, (_event, args) => {
        const session = sessionStore.updateModel(args.sessionId, args.providerKey, args.modelId);
        mainWindow?.webContents.send(IPC_CHANNELS.onSessionChanged, session);
    });
    ipcMain.handle(IPC_CHANNELS.updateConfig, (_event, next) => configStore.update(next));
    ipcMain.handle(IPC_CHANNELS.syncProviderModels, async (_event, args) => {
        const providerKey = args?.providerKey;
        if (!providerKey) {
            return { ok: false, error: "缺少 providerKey" };
        }
        const provider = configStore.get().models?.[providerKey];
        if (!provider) {
            return { ok: false, error: `未找到 provider: ${providerKey}` };
        }
        try {
            const remoteIds = await fetchProviderModelIds(provider);
            const mergedProvider = mergeProviderModels(provider, remoteIds);
            const config = configStore.updateProvider(providerKey, mergedProvider);
            return {
                ok: true,
                providerKey,
                count: mergedProvider.models.length,
                config,
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
    const appPaths = getAppPaths();
    configStore = new ConfigStore(appPaths.configFile);
    const getWorkspace = () => resolveWorkspace(configStore);
    const workspaceMemory = new WorkspaceMemory(getWorkspace, appPaths.memoryDir);
    workspaceMemory.bootstrapIfNeeded();

    skillLoader = new SkillLoader(appPaths.skillsDir);
    skillLoader.bootstrapIfNeeded();

    const getAgentTools = () => {
        const agent =
            configStore.get().agents.list.find((entry) => entry.is_default) ||
            configStore.get().agents.list[0];
        return agent?.tools || { enable_tools: true, enable_file_tools: true, enable_skills: true };
    };

    const toolRegistry = new ToolRegistry(() =>
        createBuiltinTools({
            getWorkspace,
            workspaceMemory,
            skillLoader,
            getAgentTools,
        }),
    );

    const primary = configStore.resolvePrimaryRef();
    sessionStore = new SessionStore(appPaths.sessionsDir, primary);
    const llmClient = new LlmClient((providerKey) => configStore.get().models[providerKey]);
    runtime = new AgentRuntime(
        sessionStore,
        configStore,
        llmClient,
        toolRegistry,
        workspaceMemory,
        skillLoader,
        () => mainWindow,
    );
    registerIpc();
}

app.whenReady().then(() => {
    applyAppIcon();
    bootstrap();
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
