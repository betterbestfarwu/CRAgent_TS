import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";

const pending = new Map();

export function registerPlanApprovalBridge() {
    ipcMain.on("ui:planApprovalResponse", (_event, payload) => {
        const { id, approved, content, feedback } = payload || {};
        const resolve = pending.get(id);
        if (!resolve) return;
        pending.delete(id);
        resolve({
            approved: Boolean(approved),
            content: typeof content === "string" ? content : undefined,
            feedback: typeof feedback === "string" ? feedback : undefined,
        });
    });
}

/**
 * @param {import('electron').BrowserWindow | null | undefined} mainWindow
 * @param {{ filePath: string, displayPath: string, content: string }} draft
 */
export function requestPlanApproval(mainWindow, draft) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return Promise.resolve({ approved: true, content: draft.content });
    }

    return new Promise((resolve) => {
        const id = randomUUID();
        pending.set(id, resolve);
        mainWindow.webContents.send("ui:planApprovalRequest", {
            id,
            filePath: draft.filePath,
            displayPath: draft.displayPath,
            content: draft.content,
        });
    });
}
