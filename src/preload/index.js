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
    getSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.getSession, sessionId),
    newSession: () => ipcRenderer.invoke(IPC_CHANNELS.newSession),
    deleteSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.deleteSession, sessionId),
    deleteMessages: (args) => ipcRenderer.invoke(IPC_CHANNELS.deleteMessages, args),
    sendChat: (request) => ipcRenderer.invoke(IPC_CHANNELS.sendChat, request),
    updateModel: (args) => ipcRenderer.invoke(IPC_CHANNELS.updateModel, args),
    updateConfig: (next) => ipcRenderer.invoke(IPC_CHANNELS.updateConfig, next),
    syncProviderModels: (args) => ipcRenderer.invoke(IPC_CHANNELS.syncProviderModels, args),
    onMessageAppended: (callback) => subscribe(IPC_CHANNELS.onMessageAppended, callback),
    onSessionChanged: (callback) => subscribe(IPC_CHANNELS.onSessionChanged, callback),
    onBusyChanged: (callback) => subscribe(IPC_CHANNELS.onBusyChanged, callback),
    onError: (callback) => subscribe(IPC_CHANNELS.onError, callback),
    onOpenSettings: (callback) => subscribe("ui:openSettings", callback),
};
contextBridge.exposeInMainWorld("cragent", api);
