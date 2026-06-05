const emptyImage = {
    isEmpty: () => true,
    toDataURL: () => "",
};

export const app = {
    dock: {
        setIcon: () => {},
    },
    getFileIcon: async () => emptyImage,
};

export const nativeImage = {
    createFromPath: () => emptyImage,
};

export const dialog = {
    showMessageBox: async () => ({ response: 0 }),
};

export const ipcMain = {
    handle: () => {},
    on: () => {},
    removeHandler: () => {},
};

export const ipcRenderer = {
    invoke: async () => undefined,
    on: () => {},
    removeListener: () => {},
    send: () => {},
};

export const contextBridge = {
    exposeInMainWorld: () => {},
};

export const BrowserWindow = class {};

export const Menu = {
    buildFromTemplate: () => ({}),
    setApplicationMenu: () => {},
};

export const shell = {
    openExternal: async () => {},
    showItemInFolder: () => {},
};

export const screen = {
    getAllDisplays: () => [],
};
