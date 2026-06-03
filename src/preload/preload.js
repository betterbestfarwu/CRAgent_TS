import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/ipc";
import { stripMessageImagesForUi, stripSessionImagesForUi } from "@shared/sessionForUi.js";

function asUiSession(session) {
    return session?.messages ? stripSessionImagesForUi(session) : session;
}

async function invokeUiSession(channel, ...args) {
    return asUiSession(await ipcRenderer.invoke(channel, ...args));
}

function subscribe(channel, callback) {
    const listener = (_event, payload) => {
        if (channel === IPC_CHANNELS.onSessionChanged) {
            callback(asUiSession(payload));
            return;
        }
        if (channel === IPC_CHANNELS.onMessageAppended && payload?.message) {
            callback({
                ...payload,
                message: stripMessageImagesForUi(payload.message),
            });
            return;
        }
        callback(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
}

const api = {
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
    openConfigFile: () => ipcRenderer.invoke(IPC_CHANNELS.openConfigFile),
    listSkills: () => ipcRenderer.invoke(IPC_CHANNELS.listSkills),
    listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listProjects),
    addProject: (directoryPath) => ipcRenderer.invoke(IPC_CHANNELS.addProject, directoryPath),
    pickProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.pickProjectDirectory),
    listProjectDirectory: (args) => ipcRenderer.invoke(IPC_CHANNELS.listProjectDirectory, args),
    getSession: (sessionId, options) =>
        invokeUiSession(IPC_CHANNELS.getSession, sessionId, options),
    getSessionContextDetail: (sessionId) =>
        ipcRenderer.invoke(IPC_CHANNELS.getSessionContextDetail, sessionId),
    newSession: (args) => invokeUiSession(IPC_CHANNELS.newSession, args),
    deleteSession: (sessionId) => invokeUiSession(IPC_CHANNELS.deleteSession, sessionId),
    deleteMessages: (args) => invokeUiSession(IPC_CHANNELS.deleteMessages, args),
    sendChat: (request) => ipcRenderer.invoke(IPC_CHANNELS.sendChat, request),
    exitPlanMode: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.exitPlanMode, sessionId),
    openPlanFile: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.openPlanFile, sessionId),
    readPlanContent: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.readPlanContent, sessionId),
    updateModel: (args) => ipcRenderer.invoke(IPC_CHANNELS.updateModel, args),
    updateConfig: (next) => ipcRenderer.invoke(IPC_CHANNELS.updateConfig, next),
    syncProviderModels: (args) => ipcRenderer.invoke(IPC_CHANNELS.syncProviderModels, args),
    probeMcp: (mcp) => ipcRenderer.invoke(IPC_CHANNELS.probeMcp, mcp),
    getMcpStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getMcpStatus),
    onMessageAppended: (callback) => subscribe(IPC_CHANNELS.onMessageAppended, callback),
    onSessionChanged: (callback) => subscribe(IPC_CHANNELS.onSessionChanged, callback),
    onBusyChanged: (callback) => subscribe(IPC_CHANNELS.onBusyChanged, callback),
    onError: (callback) => subscribe(IPC_CHANNELS.onError, callback),
    onHookLog: (callback) => subscribe(IPC_CHANNELS.onHookLog, callback),
    getHookLogs: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.getHookLogs, sessionId),
    clearHookLogs: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.clearHookLogs, sessionId),
};
contextBridge.exposeInMainWorld("cragent", api);
