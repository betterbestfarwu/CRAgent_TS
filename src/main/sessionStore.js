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
function normalizeProjectId(projectId) {
    if (typeof projectId !== "string") {
        return null;
    }
    const trimmed = projectId.trim();
    return trimmed ? trimmed : null;
}
export class SessionStore {
    constructor(sessionsDir, defaultModel, projectsFile) {
        this.sessionsDir = sessionsDir;
        this.defaultModel = defaultModel;
        this.projectsFile = projectsFile;
    }
    listProjects() {
        if (!this.projectsFile || !fs.existsSync(this.projectsFile)) {
            return [];
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.projectsFile, "utf-8"));
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed
                .filter((item) => item && typeof item === "object")
                .map((item) => ({
                    id: String(item.id || "").trim(),
                    name: String(item.name || "").trim(),
                    directoryPath: String(item.directoryPath || "").trim(),
                    createdAt: String(item.createdAt || nowIso()),
                    updatedAt: String(item.updatedAt || nowIso()),
                }))
                .filter((item) => item.id && item.directoryPath)
                .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
        } catch {
            return [];
        }
    }
    persistProjects(projects) {
        if (!this.projectsFile) {
            return;
        }
        const payload = JSON.stringify(projects, null, 2);
        const tmp = `${this.projectsFile}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, payload, { encoding: "utf-8", mode: 0o644 });
        fs.renameSync(tmp, this.projectsFile);
    }
    addProject(directoryPath) {
        const cleanPath = String(directoryPath || "").trim();
        if (!cleanPath) {
            throw new Error("目录路径不能为空");
        }
        const projects = this.listProjects();
        const existing = projects.find(
            (project) => project.directoryPath.toLowerCase() === cleanPath.toLowerCase(),
        );
        if (existing) {
            return existing;
        }
        const createdAt = nowIso();
        const project = {
            id: randomUUID(),
            name: path.basename(cleanPath) || cleanPath,
            directoryPath: cleanPath,
            createdAt,
            updatedAt: createdAt,
        };
        this.persistProjects([...projects, project]);
        return project;
    }
    listMetas() {
        const metas = [];
        const files = fs
            .readdirSync(this.sessionsDir)
            .filter((f) => f.endsWith(".json"))
            .sort((a, b) => fs.statSync(path.join(this.sessionsDir, b)).mtimeMs - fs.statSync(path.join(this.sessionsDir, a)).mtimeMs);
        for (const file of files) {
            const session = JSON.parse(fs.readFileSync(path.join(this.sessionsDir, file), "utf-8"));
            metas.push({
                ...session.meta,
                projectId: normalizeProjectId(session.meta.projectId),
            });
        }
        if (metas.length === 0) {
            return [this.newSession().meta];
        }
        return metas;
    }
    findPlaceholderSession(projectId = null) {
        const normalizedProjectId = normalizeProjectId(projectId);
        const candidates = [];
        for (const meta of this.listMetas()) {
            if (normalizeProjectId(meta.projectId) !== normalizedProjectId) {
                continue;
            }
            if (!isDefaultSessionTitle(meta.title)) {
                continue;
            }
            candidates.push(this.get(meta.id));
        }
        return pickPlaceholderSession(candidates);
    }
    openNewSession(options = {}) {
        const normalizedProjectId = normalizeProjectId(options.projectId);
        const existing = this.findPlaceholderSession(normalizedProjectId);
        if (existing) {
            return existing;
        }
        return this.newSession({ projectId: normalizedProjectId });
    }
    newSession(options = {}) {
        const id = randomUUID();
        const timestamp = nowIso();
        const projectId = normalizeProjectId(options.projectId);
        const session = {
            meta: {
                id,
                title: "新会话",
                providerKey: this.defaultModel.providerKey,
                modelId: this.defaultModel.modelId,
                projectId,
                createdAt: timestamp,
                updatedAt: timestamp,
                todos: [],
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
        const session = JSON.parse(fs.readFileSync(file, "utf-8"));
        session.meta.projectId = normalizeProjectId(session.meta.projectId);
        return session;
    }
    getProjectDirectory(sessionId) {
        const session = this.get(sessionId);
        const projectId = normalizeProjectId(session.meta.projectId);
        if (!projectId) {
            return null;
        }
        const project = this.listProjects().find((item) => item.id === projectId);
        const directoryPath = String(project?.directoryPath || "").trim();
        return directoryPath || null;
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
    updateTodos(sessionId, todos) {
        const session = this.get(sessionId);
        session.meta.todos = todos;
        this.save(session);
        return session;
    }
    updateTodoRun(sessionId, runId, todos) {
        const session = this.get(sessionId);
        session.meta.todoRuns = session.meta.todoRuns || {};
        session.meta.todoRuns[runId] = {
            todos,
            updatedAt: new Date().toISOString(),
        };
        session.meta.todos = todos;
        this.save(session);
        return session;
    }
    updateAuthMode(sessionId, authMode) {
        const session = this.get(sessionId);
        session.meta.authMode = authMode;
        this.save(session);
        return session;
    }
    persist(session) {
        const file = path.join(this.sessionsDir, `${session.meta.id}.json`);
        const payload = JSON.stringify(session, null, 2);
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        try {
            fs.writeFileSync(tmp, payload, { encoding: "utf-8", mode: 0o644 });
            fs.renameSync(tmp, file);
        } catch (error) {
            if (error?.code === "EACCES" && fs.existsSync(file)) {
                fs.chmodSync(file, 0o644);
                fs.writeFileSync(tmp, payload, { encoding: "utf-8", mode: 0o644 });
                fs.renameSync(tmp, file);
            } else {
                throw error;
            }
        } finally {
            if (fs.existsSync(tmp)) {
                try {
                    fs.unlinkSync(tmp);
                } catch {
                    /* ignore stale tmp */
                }
            }
        }
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
