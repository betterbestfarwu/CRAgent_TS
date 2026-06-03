import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/ipc.js";

const pending = new Map();

export function registerAskBridge() {
    ipcMain.handle(IPC_CHANNELS.respondAskUser, (_event, payload) => {
        const { id, answers } = payload || {};
        const resolve = pending.get(id);
        if (!resolve) {
            return { ok: false };
        }
        pending.delete(id);
        resolve(answers || {});
        return { ok: true };
    });
}

export function requestAskUserChoice(mainWindow, { questions }) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return Promise.reject(new Error("无法显示选项：窗口不可用"));
    }

    return new Promise((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => {
            if (!pending.has(id)) {
                return;
            }
            pending.delete(id);
            reject(new Error("等待用户选择超时"));
        }, 600_000);

        pending.set(id, (answers) => {
            clearTimeout(timer);
            resolve(answers || {});
        });

        mainWindow.webContents.send(IPC_CHANNELS.onAskUserRequest, {
            id,
            questions: Array.isArray(questions) ? questions : [],
        });
    });
}
