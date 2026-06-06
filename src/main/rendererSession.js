import { IPC_CHANNELS } from "@shared/ipc.js";
import { stripMessageImagesForUi, stripSessionImagesForUi } from "@shared/sessionForUi.js";

export function sessionForRenderer(session) {
    return stripSessionImagesForUi(session);
}

export function ipcPayloadForRenderer(channel, payload) {
    if (channel === IPC_CHANNELS.onSessionChanged) {
        return sessionForRenderer(payload);
    }
    if (channel === IPC_CHANNELS.onMessageAppended && payload?.message) {
        return {
            ...payload,
            message: stripMessageImagesForUi(payload.message, {
                preserveDataUrl: true,
            }),
        };
    }
    return payload;
}
