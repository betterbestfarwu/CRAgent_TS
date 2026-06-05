import { stripInlineImagePayloads } from "./imagePayloads.js";

/** Strip heavy image payloads before sending sessions to the renderer. */
export function stripMessageImagesForUi(message) {
    if (!message) {
        return message;
    }

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
        next.images = message.images.map((image) => ({
            mimeType: image.mimeType,
            hasData: Boolean(image.dataUrl),
        }));
        changed = true;
    }

    return changed ? next : message;
}

export function stripSessionImagesForUi(session) {
    if (!session?.messages?.length) {
        return session;
    }

    let changed = false;
    const messages = session.messages.map((message) => {
        if (!message?.images?.length) {
            return message;
        }
        changed = true;
        return stripMessageImagesForUi(message);
    });

    return changed ? { ...session, messages } : session;
}
