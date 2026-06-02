import fs from "node:fs";
import path from "node:path";
import { readSessionMetaFromFile } from "./sessionMeta.js";

export function sessionDir(sessionsDir, sessionId) {
    return path.join(sessionsDir, sessionId);
}

export function legacySessionFile(sessionsDir, sessionId) {
    return path.join(sessionsDir, `${sessionId}.json`);
}

export function metaFile(sessionsDir, sessionId) {
    return path.join(sessionDir(sessionsDir, sessionId), "meta.json");
}

export function messagesFile(sessionsDir, sessionId) {
    return path.join(sessionDir(sessionsDir, sessionId), "messages.ndjson");
}

export function isSplitSession(sessionsDir, sessionId) {
    return fs.existsSync(metaFile(sessionsDir, sessionId));
}

export function deriveMessageStats(messages) {
    const list = messages || [];
    return {
        messageCount: list.length,
        hasUserMessages: list.some((message) => message?.role === "user"),
    };
}

export function enrichMeta(meta, messages) {
    const stats = deriveMessageStats(messages);
    return {
        ...meta,
        messageCount: stats.messageCount,
        hasUserMessages: stats.hasUserMessages,
    };
}

export function readMeta(sessionsDir, sessionId) {
    const file = metaFile(sessionsDir, sessionId);
    if (!fs.existsSync(file)) {
        throw new Error(`Session meta not found: ${sessionId}`);
    }
    return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export function writeMeta(sessionsDir, meta) {
    const dir = sessionDir(sessionsDir, meta.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "meta.json");
    const payload = JSON.stringify(meta, null, 2);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(tmp, payload, { encoding: "utf-8", mode: 0o644 });
        fs.renameSync(tmp, file);
    } finally {
        if (fs.existsSync(tmp)) {
            try {
                fs.unlinkSync(tmp);
            } catch {
                /* ignore */
            }
        }
    }
}

/** Count non-empty NDJSON lines without parsing JSON. */
function countNdjsonLines(filePath) {
    const fd = fs.openSync(filePath, "r");
    const bufSize = 256 * 1024;
    const buf = Buffer.alloc(bufSize);
    let lineCount = 0;
    let leftover = "";
    let offset = 0;
    try {
        let bytesRead = 0;
        while ((bytesRead = fs.readSync(fd, buf, 0, bufSize, offset)) > 0) {
            offset += bytesRead;
            const chunk = leftover + buf.toString("utf-8", 0, bytesRead);
            const parts = chunk.split("\n");
            leftover = parts.pop() ?? "";
            for (const line of parts) {
                if (line.trim()) {
                    lineCount += 1;
                }
            }
        }
        if (leftover.trim()) {
            lineCount += 1;
        }
    } finally {
        fs.closeSync(fd);
    }
    return lineCount;
}

/** Read the last `lineLimit` non-empty lines without loading the whole file. */
function readNdjsonTailLines(filePath, lineLimit) {
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, "r");
    const chunkSize = 256 * 1024;
    let position = stat.size;
    let carry = "";
    const collected = [];
    try {
        while (position > 0 && collected.length < lineLimit) {
            const readSize = Math.min(chunkSize, position);
            position -= readSize;
            const buf = Buffer.alloc(readSize);
            fs.readSync(fd, buf, 0, readSize, position);
            const chunk = buf.toString("utf-8") + carry;
            const parts = chunk.split("\n");
            carry = parts.shift() ?? "";
            for (let i = parts.length - 1; i >= 0; i -= 1) {
                const line = parts[i];
                if (!line.trim()) {
                    continue;
                }
                collected.unshift(line);
                if (collected.length >= lineLimit) {
                    break;
                }
            }
        }
        if (collected.length < lineLimit && carry.trim()) {
            collected.unshift(carry);
        }
    } finally {
        fs.closeSync(fd);
    }
    return collected;
}

function readAllNdjsonLines(filePath) {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").filter((line) => line.trim());
}

export function readMessages(sessionsDir, sessionId, options = {}) {
    const file = messagesFile(sessionsDir, sessionId);
    if (!fs.existsSync(file)) {
        return { messages: [], totalCount: 0, hasMoreBefore: false };
    }

    const { limit, beforeMessageId } = options;

    if (limit && !beforeMessageId) {
        const totalCount = countNdjsonLines(file);
        const tailLines = readNdjsonTailLines(file, limit);
        return {
            messages: tailLines.map((line) => JSON.parse(line)),
            totalCount,
            hasMoreBefore: totalCount > limit,
        };
    }

    const lines = readAllNdjsonLines(file);
    const totalCount = lines.length;

    if (!limit && !beforeMessageId) {
        return {
            messages: lines.map((line) => JSON.parse(line)),
            totalCount,
            hasMoreBefore: false,
        };
    }

    if (beforeMessageId) {
        let beforeIndex = -1;
        for (let i = 0; i < lines.length; i += 1) {
            const message = JSON.parse(lines[i]);
            if (message.id === beforeMessageId) {
                beforeIndex = i;
                break;
            }
        }
        if (beforeIndex <= 0) {
            return { messages: [], totalCount, hasMoreBefore: false };
        }
        const start = Math.max(0, beforeIndex - limit);
        const slice = lines.slice(start, beforeIndex);
        return {
            messages: slice.map((line) => JSON.parse(line)),
            totalCount,
            hasMoreBefore: start > 0,
        };
    }

    const slice = lines.slice(-limit);
    return {
        messages: slice.map((line) => JSON.parse(line)),
        totalCount,
        hasMoreBefore: totalCount > limit,
    };
}

export function rewriteMessages(sessionsDir, sessionId, messages) {
    const file = messagesFile(sessionsDir, sessionId);
    const dir = sessionDir(sessionsDir, sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const body =
        (messages || []).length > 0
            ? `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`
            : "";
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        if (body) {
            fs.writeFileSync(tmp, body, { encoding: "utf-8", mode: 0o644 });
        } else if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            return;
        } else {
            return;
        }
        fs.renameSync(tmp, file);
    } finally {
        if (fs.existsSync(tmp)) {
            try {
                fs.unlinkSync(tmp);
            } catch {
                /* ignore */
            }
        }
    }
}

export function appendMessageLine(sessionsDir, sessionId, message) {
    const file = messagesFile(sessionsDir, sessionId);
    const dir = sessionDir(sessionsDir, sessionId);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(message)}\n`, { encoding: "utf-8", mode: 0o644 });
}

export function writeSplitSession(sessionsDir, session) {
    const sessionId = session.meta.id;
    const meta = enrichMeta(session.meta, session.messages);
    writeMeta(sessionsDir, meta);
    rewriteMessages(sessionsDir, sessionId, session.messages);
}

export function migrateLegacySessionIfNeeded(sessionsDir, sessionId) {
    if (isSplitSession(sessionsDir, sessionId)) {
        return false;
    }
    const legacy = legacySessionFile(sessionsDir, sessionId);
    if (!fs.existsSync(legacy)) {
        return false;
    }
    const session = JSON.parse(fs.readFileSync(legacy, "utf-8"));
    writeSplitSession(sessionsDir, session);
    fs.unlinkSync(legacy);
    return true;
}

export function readLegacyMeta(sessionsDir, sessionId) {
    const legacy = legacySessionFile(sessionsDir, sessionId);
    if (!fs.existsSync(legacy)) {
        return null;
    }
    return readSessionMetaFromFile(legacy);
}

export function deleteSessionFiles(sessionsDir, sessionId) {
    const legacy = legacySessionFile(sessionsDir, sessionId);
    if (fs.existsSync(legacy)) {
        fs.unlinkSync(legacy);
    }
    const dir = sessionDir(sessionsDir, sessionId);
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

export function listSessionEntries(sessionsDir) {
    if (!fs.existsSync(sessionsDir)) {
        return [];
    }
    const entries = [];
    for (const name of fs.readdirSync(sessionsDir)) {
        if (name === "_images") {
            continue;
        }
        const fullPath = path.join(sessionsDir, name);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            const metaPath = path.join(fullPath, "meta.json");
            if (fs.existsSync(metaPath)) {
                entries.push({
                    id: name,
                    mtimeMs: stat.mtimeMs,
                    kind: "split",
                });
            }
            continue;
        }
        if (name.endsWith(".json")) {
            entries.push({
                id: name.slice(0, -".json".length),
                mtimeMs: stat.mtimeMs,
                kind: "legacy",
            });
        }
    }
    return entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
