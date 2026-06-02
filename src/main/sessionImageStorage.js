import fs from "node:fs";
import path from "node:path";

function imagesDir(sessionsDir, sessionId) {
    return path.join(sessionsDir, "_images", sessionId);
}

function extForMime(mimeType) {
    switch (mimeType) {
        case "image/png":
            return ".png";
        case "image/jpeg":
        case "image/jpg":
            return ".jpg";
        case "image/webp":
            return ".webp";
        case "image/gif":
            return ".gif";
        default:
            return ".bin";
    }
}

export function sessionHasInlineImages(session) {
    return (session?.messages || []).some((message) =>
        (message?.images || []).some((image) => Boolean(image?.dataUrl)),
    );
}

export function externalizeSessionImages(session, sessionsDir) {
    if (!session?.messages?.length || !sessionsDir) {
        return session;
    }

    let changed = false;
    const sessionId = session.meta.id;

    const messages = session.messages.map((message) => {
        if (!message?.images?.length) {
            return message;
        }

        let messageChanged = false;
        const images = message.images.map((image, index) => {
            if (!image?.dataUrl) {
                return image;
            }

            const match = /^data:([^;]+);base64,([\s\S]+)$/i.exec(String(image.dataUrl));
            if (!match) {
                messageChanged = true;
                changed = true;
                return { mimeType: image.mimeType, hasData: true };
            }

            const mimeType = image.mimeType || match[1];
            const dir = imagesDir(sessionsDir, sessionId);
            fs.mkdirSync(dir, { recursive: true });
            const fileName = `${message.id}-${index}${extForMime(mimeType)}`;
            fs.writeFileSync(path.join(dir, fileName), Buffer.from(match[2], "base64"));

            messageChanged = true;
            changed = true;
            return { mimeType, imageFile: fileName };
        });

        return messageChanged ? { ...message, images } : message;
    });

    return changed ? { ...session, messages } : session;
}

export function hydrateSessionImages(session, sessionsDir) {
    if (!session?.messages?.length || !sessionsDir) {
        return session;
    }

    const sessionId = session.meta.id;
    const dir = imagesDir(sessionsDir, sessionId);
    let changed = false;

    const messages = session.messages.map((message) => {
        if (!message?.images?.length) {
            return message;
        }

        let messageChanged = false;
        const images = message.images.map((image) => {
            if (image?.dataUrl || !image?.imageFile) {
                return image;
            }
            const filePath = path.join(dir, image.imageFile);
            if (!fs.existsSync(filePath)) {
                return image;
            }
            const mimeType = image.mimeType || "image/png";
            const dataUrl = `data:${mimeType};base64,${fs.readFileSync(filePath).toString("base64")}`;
            messageChanged = true;
            changed = true;
            return { mimeType, dataUrl };
        });

        return messageChanged ? { ...message, images } : message;
    });

    return changed ? { ...session, messages } : session;
}

export function deleteSessionImages(sessionId, sessionsDir) {
    if (!sessionId || !sessionsDir) {
        return;
    }
    const dir = imagesDir(sessionsDir, sessionId);
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
