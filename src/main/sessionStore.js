import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
    isDefaultSessionTitle,
    pickPlaceholderSession,
    titleFromFirstUserMessage,
} from "@shared/sessionTitle";
function nowIso() {
    return new Date().toISOString();
}
export class SessionStore {
    constructor(sessionsDir, defaultModel) {
        this.sessionsDir = sessionsDir;
        this.defaultModel = defaultModel;
    }
    listMetas() {
        const metas = [];
        const files = fs
            .readdirSync(this.sessionsDir)
            .filter((f) => f.endsWith(".json"))
            .sort((a, b) => fs.statSync(path.join(this.sessionsDir, b)).mtimeMs - fs.statSync(path.join(this.sessionsDir, a)).mtimeMs);
        for (const file of files) {
            const session = JSON.parse(fs.readFileSync(path.join(this.sessionsDir, file), "utf-8"));
            metas.push(session.meta);
        }
        if (metas.length === 0) {
            return [this.newSession().meta];
        }
        return metas;
    }
    findPlaceholderSession() {
        const candidates = [];
        for (const meta of this.listMetas()) {
            if (!isDefaultSessionTitle(meta.title)) {
                continue;
            }
            candidates.push(this.get(meta.id));
        }
        return pickPlaceholderSession(candidates);
    }
    openNewSession() {
        const existing = this.findPlaceholderSession();
        if (existing) {
            return existing;
        }
        return this.newSession();
    }
    newSession() {
        const id = randomUUID();
        const timestamp = nowIso();
        const session = {
            meta: {
                id,
                title: "新会话",
                providerKey: this.defaultModel.providerKey,
                modelId: this.defaultModel.modelId,
                createdAt: timestamp,
                updatedAt: timestamp,
            },
            messages: [],
        };
        this.persist(session);
        return session;
    }
    get(sessionId) {
        const file = path.join(this.sessionsDir, `${sessionId}.json`);
        if (!fs.existsSync(file)) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
    save(session) {
        session.meta.updatedAt = nowIso();
        this.persist(session);
    }
    appendMessage(sessionId, message) {
        const session = this.get(sessionId);
        session.messages.push(message);
        if (message.role === "user" && isDefaultSessionTitle(session.meta.title)) {
            const derived = titleFromFirstUserMessage(message.content);
            if (derived) {
                session.meta.title = derived;
            }
        }
        this.save(session);
        return session;
    }
    removeMessages(sessionId, messageIds) {
        const idSet = new Set(messageIds);
        const session = this.get(sessionId);
        session.messages = session.messages.filter((message) => !idSet.has(message.id));
        this.save(session);
        return session;
    }
    updateModel(sessionId, providerKey, modelId) {
        const session = this.get(sessionId);
        session.meta.providerKey = providerKey;
        session.meta.modelId = modelId;
        this.save(session);
        return session;
    }
    persist(session) {
        fs.writeFileSync(path.join(this.sessionsDir, `${session.meta.id}.json`), JSON.stringify(session, null, 2), "utf-8");
    }
    delete(sessionId) {
        const file = path.join(this.sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
        }
        const remaining = this.listMetas();
        if (remaining.length) {
            return remaining[0];
        }
        return this.newSession().meta;
    }
}
