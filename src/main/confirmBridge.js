import { randomUUID } from "node:crypto";
import { dialog, ipcMain } from "electron";
import { loadAppIcon } from "./appIcon.js";

const pending = new Map();

async function fallbackNativeConfirm(options) {
    const icon = process.platform === "win32" ? loadAppIcon() : undefined;
    const result = await dialog.showMessageBox({
        type: "question",
        buttons: [options.cancelLabel || "拒绝", options.confirmLabel || "允许"],
        defaultId: 1,
        cancelId: 0,
        title: options.message || options.title || "CRAgent",
        message: options.message || "",
        detail: options.detail || "",
        ...(icon ? { icon } : {}),
    });
    return result.response === 1;
}

export function registerConfirmBridge() {
    ipcMain.on("ui:confirmResponse", (_event, payload) => {
        const { id, confirmed } = payload || {};
        const resolve = pending.get(id);
        if (!resolve) return;
        pending.delete(id);
        resolve(Boolean(confirmed));
    });
}

export function requestRendererConfirm(mainWindow, options) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return fallbackNativeConfirm(options);
    }

    return new Promise((resolve) => {
        const id = randomUUID();
        pending.set(id, resolve);
        mainWindow.webContents.send("ui:confirmRequest", {
            id,
            title: options.title,
            message: options.message,
            detail: options.detail,
            confirmLabel: options.confirmLabel,
            cancelLabel: options.cancelLabel,
            destructive: options.destructive,
        });
    });
}

export function createToolConfirmFn(getMainWindow) {
    return (toolName, details) =>
        requestRendererConfirm(getMainWindow(), {
            title: "CRAgent",
            message: `允许执行工具 ${toolName}?`,
            detail: details,
            confirmLabel: "允许",
            cancelLabel: "拒绝",
        });
}
