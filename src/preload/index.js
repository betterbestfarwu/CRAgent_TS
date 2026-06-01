import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/ipc";
function subscribe(channel, callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
}
const api = {
    isDesktop: true,
    platform: process.platform,
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
    listSkills: () => ipcRenderer.invoke(IPC_CHANNELS.listSkills),
    listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listProjects),
    addProject: (directoryPath) => ipcRenderer.invoke(IPC_CHANNELS.addProject, directoryPath),
    pickProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.pickProjectDirectory),
    listProjectDirectory: (args) => ipcRenderer.invoke(IPC_CHANNELS.listProjectDirectory, args),
    getSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.getSession, sessionId),
    newSession: (args) => ipcRenderer.invoke(IPC_CHANNELS.newSession, args),
    deleteSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.deleteSession, sessionId),
    deleteMessages: (args) => ipcRenderer.invoke(IPC_CHANNELS.deleteMessages, args),
    sendChat: (request) => ipcRenderer.invoke(IPC_CHANNELS.sendChat, request),
    cancelRun: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.cancelRun, sessionId),
    removeQueuedMessage: (args) => ipcRenderer.invoke(IPC_CHANNELS.removeQueuedMessage, args),
    updateAuthMode: (args) => ipcRenderer.invoke(IPC_CHANNELS.updateAuthMode, args),
    updateModel: (args) => ipcRenderer.invoke(IPC_CHANNELS.updateModel, args),
    updateConfig: (next) => ipcRenderer.invoke(IPC_CHANNELS.updateConfig, next),
    syncProviderModels: (args) => ipcRenderer.invoke(IPC_CHANNELS.syncProviderModels, args),
    onMessageAppended: (callback) => subscribe(IPC_CHANNELS.onMessageAppended, callback),
    onSessionChanged: (callback) => subscribe(IPC_CHANNELS.onSessionChanged, callback),
    onBusyChanged: (callback) => subscribe(IPC_CHANNELS.onBusyChanged, callback),
    onError: (callback) => subscribe(IPC_CHANNELS.onError, callback),
    onTodosChanged: (callback) => subscribe(IPC_CHANNELS.onTodosChanged, callback),
    onQueueChanged: (callback) => subscribe(IPC_CHANNELS.onQueueChanged, callback),
    onContextWarningChanged: (callback) => subscribe(IPC_CHANNELS.onContextWarningChanged, callback),
    onConfirmRequest: (callback) => subscribe(IPC_CHANNELS.onConfirmRequest, callback),
    respondConfirm: (payload) => ipcRenderer.send(IPC_CHANNELS.confirmResponse, payload),
    onOpenSettings: (callback) => subscribe("ui:openSettings", callback),
};
contextBridge.exposeInMainWorld("cragent", api);
