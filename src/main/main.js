import { app, BrowserWindow, Menu, ipcMain } from "electron";
import path from "node:path";
import { IPC_CHANNELS } from "@shared/ipc";
import { getAppPaths } from "./appPaths";
import { ConfigStore } from "./configStore";
import { SessionStore } from "./sessionStore";
import { LlmClient } from "./llmClient";
import { ToolRegistry } from "./toolRegistry";
import { AgentRuntime } from "./agentRuntime";

const devServerUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL;
const isDev = Boolean(devServerUrl) || process.env.NODE_ENV === "development";
const projectRoot = process.cwd();

let mainWindow = null;
let configStore;
let sessionStore;
let runtime;

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
    mainWindow = new BrowserWindow({
        width: 1240,
        height: 820,
        minWidth: 900,
        minHeight: 640,
        title: "CRAgent",
        backgroundColor: "#f3f3f3",
        ...windowChromeOptions(),
        webPreferences: {
            preload: path.join(__dirname, "../preload/index.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    if (isDev && devServerUrl) {
        mainWindow.loadURL(devServerUrl);
    } else if (isDev) {
        mainWindow.loadURL("http://localhost:5173");
    } else {
        mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    }
}

function buildMenu() {
    const template = [
        {
            label: "CRAgent",
            submenu: [
                { role: "about" },
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
    ipcMain.handle(IPC_CHANNELS.getSession, (_event, sessionId) => sessionStore.get(sessionId));
    ipcMain.handle(IPC_CHANNELS.newSession, () => sessionStore.openNewSession());
    ipcMain.handle(IPC_CHANNELS.sendChat, (_event, request) =>
        runtime.sendUserMessage(request.sessionId, request.userInput, request.images),
    );
    ipcMain.handle(IPC_CHANNELS.updateModel, (_event, args) => {
        const session = sessionStore.updateModel(args.sessionId, args.providerKey, args.modelId);
        mainWindow?.webContents.send(IPC_CHANNELS.onSessionChanged, session);
    });
    ipcMain.handle(IPC_CHANNELS.updateConfig, (_event, next) => configStore.update(next));
}

function bootstrap() {
    const appPaths = getAppPaths();
    configStore = new ConfigStore(appPaths.configFile);
    const primary = configStore.resolvePrimaryRef();
    sessionStore = new SessionStore(appPaths.sessionsDir, primary);
    const llmClient = new LlmClient((providerKey) => configStore.get().models[providerKey]);
    const toolRegistry = new ToolRegistry(appPaths.memoryFile);
    runtime = new AgentRuntime(sessionStore, configStore, llmClient, toolRegistry, () => mainWindow);
    registerIpc();
}

app.whenReady().then(() => {
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
