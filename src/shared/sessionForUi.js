import { stripInlineImagePayloads } from "./imagePayloads.js";

/** Strip heavy image payloads before sending sessions to the renderer. */
export function stripMessageImagesForUi(message, options = {}) {
    if (!message) {
        return message;
    }

    const preserveDataUrl = options.preserveDataUrl === true;
    let changed = false;
    const next = { ...message };

    if (typeof message.content === "string") {
        const content = stripInlineImagePayloads(message.content);
        if (content !== message.content) {
            next.content = content;
            changed = true;
        }
    }

    if (message?.toolCalls?.length) {
        const toolCalls = message.toolCalls.map((call) => {
            const args = call?.function?.arguments;
            if (typeof args !== "string") {
                return call;
            }
            const sanitized = stripInlineImagePayloads(args);
            if (sanitized === args) {
                return call;
            }
            changed = true;
            return {
                ...call,
                function: {
                    ...call.function,
                    arguments: sanitized,
                },
            };
        });
        next.toolCalls = toolCalls;
    }

    if (message.images?.length) {
        next.images = message.images.map((image, index) => ({
            index,
            mimeType: image.mimeType,
            hasData: Boolean(image.dataUrl || image.imageFile || image.hasData),
            ...(preserveDataUrl && image.dataUrl ? { dataUrl: image.dataUrl } : {}),
        }));
        changed = true;
    }

    return changed ? next : message;
}

export function messageImageKey(messageId, image, index) {
    return `${messageId}:${image?.index ?? index}`;
}

/** Keep inline image previews when a session refresh strips dataUrl payloads. */
export function mergePreservedMessageImages(prevMessages, nextMessages) {
    if (!nextMessages?.length) {
        return nextMessages || [];
    }
    if (!prevMessages?.length) {
        return nextMessages;
    }

    const dataUrlByKey = new Map();
    for (const message of prevMessages) {
        if (!message?.id || !message.images?.length) {
            continue;
        }
        message.images.forEach((image, index) => {
            if (!image?.dataUrl) {
                return;
            }
            dataUrlByKey.set(messageImageKey(message.id, image, index), {
                dataUrl: image.dataUrl,
                mimeType: image.mimeType,
            });
        });
    }

    if (!dataUrlByKey.size) {
        return nextMessages;
    }

    let changed = false;
    const messages = nextMessages.map((message) => {
        if (!message?.id || !message.images?.length) {
            return message;
        }

        let messageChanged = false;
        const images = message.images.map((image, index) => {
            if (image?.dataUrl) {
                return image;
            }
            const preserved = dataUrlByKey.get(messageImageKey(message.id, image, index));
            if (!preserved) {
                return image;
            }
            messageChanged = true;
            return {
                ...image,
                dataUrl: preserved.dataUrl,
                ...(image.mimeType ? {} : { mimeType: preserved.mimeType }),
            };
        });

        if (!messageChanged) {
            return message;
        }
        changed = true;
        return { ...message, images };
    });

    return changed ? messages : nextMessages;
}

export function stripSessionImagesForUi(session) {
    if (!session?.messages?.length) {
        return session;
    }

    let changed = false;
    const messages = session.messages.map((message) => {
        const stripped = stripMessageImagesForUi(message);
        if (stripped === message) {
            return message;
        }
        changed = true;
        return stripped;
    });

    return changed ? { ...session, messages } : session;
}
