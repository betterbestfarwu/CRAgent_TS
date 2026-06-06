import fs from "node:fs";
import path from "node:path";
import {
    extractInlineImagePayloads,
    hasInlineImagePayloads,
} from "@shared/imagePayloads.js";
import { sessionDir } from "./sessionStorage.js";

function imagesDir(sessionsDir, sessionId) {
    return path.join(sessionDir(sessionsDir, sessionId), "_images");
}

function legacySplitImagesDir(sessionsDir, sessionId) {
    return path.join(sessionDir(sessionsDir, sessionId), "_Images");
}

function legacyGlobalImagesDir(sessionsDir, sessionId) {
    return path.join(sessionsDir, "_images", sessionId);
}

function candidateImageDirs(sessionsDir, sessionId) {
    return [
        legacySplitImagesDir(sessionsDir, sessionId),
        imagesDir(sessionsDir, sessionId),
        legacyGlobalImagesDir(sessionsDir, sessionId),
    ];
}

function mimeTypeFromImageFile(imageFile) {
    switch (path.extname(String(imageFile || "")).toLowerCase()) {
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".webp":
            return "image/webp";
        case ".gif":
            return "image/gif";
        default:
            return "";
    }
}

function resolveImageFilePath(sessionsDir, sessionId, imageFile) {
    for (const dir of candidateImageDirs(sessionsDir, sessionId)) {
        const filePath = path.join(dir, imageFile);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return null;
}

export function getSessionImageFilePath(sessionsDir, sessionId, imageFile) {
    return resolveImageFilePath(sessionsDir, sessionId, imageFile);
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
        (message?.images || []).some((image) => Boolean(image?.dataUrl)) ||
        hasInlineImagePayloads(message?.content),
    );
}

export function externalizeSessionImages(session, sessionsDir) {
    if (!session?.messages?.length || !sessionsDir) {
        return session;
    }

    let changed = false;
    const sessionId = session.meta.id;

    const messages = session.messages.map((message) => {
        const extracted = extractInlineImagePayloads(message?.content);
        const originalImages = Array.isArray(message?.images) ? message.images : [];
        const combinedImages = extracted.images.length
            ? [...originalImages, ...extracted.images]
            : originalImages;

        if (!combinedImages.length && !extracted.changed) {
            return message;
        }

        let messageChanged = extracted.changed;
        if (extracted.changed) {
            changed = true;
        }
        const images = combinedImages.map((image, index) => {
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

        return messageChanged
            ? {
                  ...message,
                  content: extracted.changed ? extracted.text : message.content,
                  ...(images.length ? { images } : {}),
              }
            : message;
    });

    return changed ? { ...session, messages } : session;
}

export function readSessionImageFile(sessionsDir, sessionId, imageFile, mimeType = "") {
    if (!sessionsDir || !sessionId || !imageFile) {
        return null;
    }
    const filePath = resolveImageFilePath(sessionsDir, sessionId, imageFile);
    if (!filePath) {
        return null;
    }
    const resolvedMime =
        mimeType || mimeTypeFromImageFile(imageFile) || "image/png";
    return {
        mimeType: resolvedMime,
        dataUrl: `data:${resolvedMime};base64,${fs.readFileSync(filePath).toString("base64")}`,
    };
}

export function hydrateSessionImages(session, sessionsDir) {
    if (!session?.messages?.length || !sessionsDir) {
        return session;
    }

    const sessionId = session.meta.id;
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
            const hydrated = readSessionImageFile(
                sessionsDir,
                sessionId,
                image.imageFile,
                image.mimeType,
            );
            if (!hydrated?.dataUrl) {
                return image;
            }
            messageChanged = true;
            changed = true;
            return hydrated;
        });

        return messageChanged ? { ...message, images } : message;
    });

    return changed ? { ...session, messages } : session;
}

export function deleteSessionImages(sessionId, sessionsDir) {
    if (!sessionId || !sessionsDir) {
        return;
    }
    for (const dir of candidateImageDirs(sessionsDir, sessionId)) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
}
