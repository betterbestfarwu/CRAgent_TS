import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_UI_MESSAGE_PAGE } from "@shared/sessionPaging.js";
import {
    isDefaultSessionTitle,
    pickPlaceholderSession,
    titleFromFirstUserMessage,
} from "@shared/sessionTitle";
import {
    appendMessageLine,
    deleteSessionFiles,
    enrichMeta,
    isSplitSession,
    listSessionEntries,
    messagesFile,
    migrateLegacySessionIfNeeded,
    moveSessionStorage,
    readLegacyMeta,
    readMessages,
    readMeta,
    rewriteMessages,
    sessionExistsInDir,
    writeMeta,
    writeSplitSession,
} from "./sessionStorage.js";
import {
    projectSessionsDir as resolveProjectSessionsDir,
    projectStorageRoot,
    projectsStorageRoot,
} from "@shared/projectStoragePaths.js";
import {
    deleteSessionImages,
    externalizeSessionImages,
    hydrateSessionImages,
    sessionHasInlineImages,
} from "./sessionImageStorage.js";
import {
    indexSessionsByProjectId,
    normalizeProjectSessions,
    repairProjectRecords,
} from "@shared/projectSessions.js";

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

function parseProjectRecord(item) {
    return {
        id: String(item.id || "").trim(),
        name: String(item.name || "").trim(),
        directoryPath: String(item.directoryPath || "").trim(),
        createdAt: String(item.createdAt || nowIso()),
        updatedAt: String(item.updatedAt || nowIso()),
        sessions: normalizeProjectSessions(item.sessions),
    };
}

function projectForRenderer(project) {
    return {
        id: project.id,
        name: project.name,
        directoryPath: project.directoryPath,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
    };
}

function normalizeGetOptions(options = {}) {
    const paginated =
        options.messageLimit !== undefined || options.beforeMessageId !== undefined;
    return {
        hydrateImages: options.hydrateImages !== false,
        messageLimit: paginated
            ? options.messageLimit ?? DEFAULT_UI_MESSAGE_PAGE
            : undefined,
        beforeMessageId: options.beforeMessageId,
        loadAllMessages: !paginated,
    };
}

export class SessionStore {
    constructor(sessionsDir, defaultModel, projectsFile, projectsDir = null) {
        this.sessionsDir = sessionsDir;
        this.projectsDir =
            projectsDir ?? projectsStorageRoot(path.dirname(sessionsDir));
        this.defaultModel = defaultModel;
        this.projectsFile = projectsFile;
        fs.mkdirSync(this.sessionsDir, { recursive: true });
        fs.mkdirSync(this.projectsDir, { recursive: true });
        this.ensureAllProjectLayouts();
        this.migrateGlobalProjectSessions();
        this.repairProjectsFile();
    }

    projectSessionsDir(projectId) {
        return resolveProjectSessionsDir(this.projectsDir, projectId);
    }

    ensureProjectLayout(projectId) {
        const id = normalizeProjectId(projectId);
        if (!id) {
            return;
        }
        fs.mkdirSync(projectStorageRoot(this.projectsDir, id), { recursive: true });
        fs.mkdirSync(this.projectSessionsDir(id), { recursive: true });
    }

    ensureAllProjectLayouts() {
        for (const project of this.readRawProjects()) {
            this.ensureProjectLayout(project.id);
        }
    }

    locateSessionStorage(sessionId) {
        const cleanSessionId = String(sessionId || "").trim();
        if (!cleanSessionId) {
            throw new Error("缺少 sessionId");
        }
        if (sessionExistsInDir(this.sessionsDir, cleanSessionId)) {
            return this.sessionsDir;
        }
        for (const project of this.readRawProjects()) {
            const dir = this.projectSessionsDir(project.id);
            if (sessionExistsInDir(dir, cleanSessionId)) {
                return dir;
            }
        }
        throw new Error(`Session not found: ${cleanSessionId}`);
    }

    resolveSessionsDirForNew(projectId) {
        const normalized = normalizeProjectId(projectId);
        if (normalized) {
            this.ensureProjectLayout(normalized);
            return this.projectSessionsDir(normalized);
        }
        return this.sessionsDir;
    }

    collectMetasFromDir(sessionsDir, { expectedProjectId = undefined } = {}) {
        const metas = [];
        for (const entry of listSessionEntries(sessionsDir)) {
            let meta;
            if (entry.kind === "split") {
                meta = readMeta(sessionsDir, entry.id);
            } else {
                meta = readLegacyMeta(sessionsDir, entry.id);
                if (!meta) {
                    continue;
                }
            }
            const metaProjectId = normalizeProjectId(meta.projectId);
            if (expectedProjectId === null && metaProjectId) {
                continue;
            }
            const projectId =
                typeof expectedProjectId === "string" ? expectedProjectId : metaProjectId;
            metas.push({
                ...meta,
                projectId,
            });
        }
        return metas;
    }

    migrateGlobalProjectSessions() {
        const projectIds = new Set(this.readRawProjects().map((project) => project.id));
        for (const entry of listSessionEntries(this.sessionsDir)) {
            let meta;
            if (entry.kind === "split") {
                meta = readMeta(this.sessionsDir, entry.id);
            } else {
                meta = readLegacyMeta(this.sessionsDir, entry.id);
                if (!meta) {
                    continue;
                }
            }
            const projectId = normalizeProjectId(meta.projectId);
            if (!projectId || !projectIds.has(projectId)) {
                continue;
            }
            this.ensureProjectLayout(projectId);
            moveSessionStorage(
                this.sessionsDir,
                this.projectSessionsDir(projectId),
                entry.id,
            );
        }
    }

    listMetasOnDisk() {
        const metas = this.collectMetasFromDir(this.sessionsDir, { expectedProjectId: null });
        for (const project of this.readRawProjects()) {
            this.ensureProjectLayout(project.id);
            metas.push(
                ...this.collectMetasFromDir(this.projectSessionsDir(project.id), {
                    expectedProjectId: project.id,
                }),
            );
        }
        return metas;
    }

    repairProjectsFile() {
        if (!this.projectsFile || !fs.existsSync(this.projectsFile)) {
            return { changed: false, projects: [] };
        }
        let projects;
        try {
            const parsed = JSON.parse(fs.readFileSync(this.projectsFile, "utf-8"));
            if (!Array.isArray(parsed)) {
                return { changed: false, projects: [] };
            }
            projects = parsed
                .map((item) => parseProjectRecord(item))
                .filter((item) => item.id && item.directoryPath);
        } catch {
            return { changed: false, projects: [] };
        }
        const sessionsByProjectId = indexSessionsByProjectId(this.listMetasOnDisk());
        const { projects: repaired, changed } = repairProjectRecords(projects, sessionsByProjectId, {
            now: nowIso,
        });
        if (changed) {
            this.persistProjects(repaired);
        }
        return { changed, projects: repaired };
    }

    readRawProjects() {
        if (!this.projectsFile || !fs.existsSync(this.projectsFile)) {
            return [];
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.projectsFile, "utf-8"));
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed
                .map((item) => parseProjectRecord(item))
                .filter((item) => item.id && item.directoryPath);
        } catch {
            return [];
        }
    }

    listProjects() {
        return this.readRawProjects()
            .map((project) => projectForRenderer(project))
            .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
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

    mutateProject(projectId, mutator) {
        const id = normalizeProjectId(projectId);
        if (!id) {
            return null;
        }
        const projects = this.readRawProjects();
        const index = projects.findIndex((item) => item.id === id);
        if (index < 0) {
            return null;
        }
        const timestamp = nowIso();
        const next = mutator({ ...projects[index], updatedAt: timestamp });
        if (!next) {
            return null;
        }
        projects[index] = {
            ...next,
            updatedAt: timestamp,
            sessions: normalizeProjectSessions(next.sessions),
        };
        this.persistProjects(projects);
        return projects[index];
    }

    registerProjectSession(projectId, sessionId, name = "新会话") {
        const cleanSessionId = String(sessionId || "").trim();
        if (!cleanSessionId) {
            return;
        }
        const sessionName = String(name || "").trim() || "新会话";
        this.mutateProject(projectId, (project) => {
            const sessions = normalizeProjectSessions(project.sessions);
            const existing = sessions.find((item) => item.sessionId === cleanSessionId);
            if (existing) {
                existing.name = sessionName;
                return { ...project, sessions };
            }
            return {
                ...project,
                sessions: [...sessions, { sessionId: cleanSessionId, name: sessionName }],
            };
        });
    }

    unregisterProjectSession(projectId, sessionId) {
        const cleanSessionId = String(sessionId || "").trim();
        if (!cleanSessionId) {
            return;
        }
        this.mutateProject(projectId, (project) => ({
            ...project,
            sessions: normalizeProjectSessions(project.sessions).filter(
                (item) => item.sessionId !== cleanSessionId,
            ),
        }));
    }

    syncProjectSessionName(projectId, sessionId, name) {
        const cleanSessionId = String(sessionId || "").trim();
        const sessionName = String(name || "").trim();
        if (!cleanSessionId || !sessionName) {
            return;
        }
        this.mutateProject(projectId, (project) => {
            const sessions = normalizeProjectSessions(project.sessions);
            const target = sessions.find((item) => item.sessionId === cleanSessionId);
            if (!target || target.name === sessionName) {
                return project;
            }
            target.name = sessionName;
            return { ...project, sessions };
        });
    }

    addProject(directoryPath) {
        const cleanPath = String(directoryPath || "").trim();
        if (!cleanPath) {
            throw new Error("目录路径不能为空");
        }
        const projects = this.readRawProjects();
        const existing = projects.find(
            (project) => project.directoryPath.toLowerCase() === cleanPath.toLowerCase(),
        );
        if (existing) {
            this.ensureProjectLayout(existing.id);
            return projectForRenderer(existing);
        }
        const createdAt = nowIso();
        const project = {
            id: randomUUID(),
            name: path.basename(cleanPath) || cleanPath,
            directoryPath: cleanPath,
            createdAt,
            updatedAt: createdAt,
            sessions: [],
        };
        this.ensureProjectLayout(project.id);
        this.persistProjects([...projects, project]);
        return projectForRenderer(project);
    }

    removeProject(projectId) {
        const id = normalizeProjectId(projectId);
        if (!id) {
            throw new Error("缺少 projectId");
        }
        const projects = this.readRawProjects();
        const project = projects.find((item) => item.id === id);
        if (!project) {
            throw new Error("未找到项目");
        }
        const deletedSessionIds = normalizeProjectSessions(project.sessions).map(
            (item) => item.sessionId,
        );
        this.persistProjects(projects.filter((item) => item.id !== id));
        const projectRoot = projectStorageRoot(this.projectsDir, id);
        if (fs.existsSync(projectRoot)) {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
        const remaining = this.listMetas();
        return {
            projectId: id,
            deletedSessionIds,
            fallbackSessionId: remaining[0]?.id ?? null,
        };
    }

    listMetas() {
        const metas = this.listMetasOnDisk();
        if (metas.length === 0) {
            return [this.newSession().meta];
        }
        return metas;
    }

    ensureMigrated(sessionId) {
        const sessionsDir = this.locateSessionStorage(sessionId);
        migrateLegacySessionIfNeeded(sessionsDir, sessionId);
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
            if (meta.hasUserMessages) {
                continue;
            }
            candidates.push({ meta, messages: [] });
        }
        return pickPlaceholderSession(candidates);
    }

    openNewSession(options = {}) {
        const normalizedProjectId = normalizeProjectId(options.projectId);
        const existing = this.findPlaceholderSession(normalizedProjectId);
        if (existing) {
            if (normalizedProjectId) {
                this.registerProjectSession(
                    normalizedProjectId,
                    existing.meta.id,
                    existing.meta.title,
                );
            }
            return existing;
        }
        return this.newSession({ projectId: normalizedProjectId });
    }

    newSession(options = {}) {
        const id = randomUUID();
        const timestamp = nowIso();
        const projectId = normalizeProjectId(options.projectId);
        const meta = enrichMeta(
            {
                id,
                title: "新会话",
                providerKey: this.defaultModel.providerKey,
                modelId: this.defaultModel.modelId,
                projectId,
                createdAt: timestamp,
                updatedAt: timestamp,
                todos: [],
            },
            [],
        );
        const sessionsDir = this.resolveSessionsDirForNew(projectId);
        writeMeta(sessionsDir, meta);
        if (projectId) {
            this.registerProjectSession(projectId, id, meta.title);
        }
        return { meta, messages: [] };
    }

    get(sessionId, options = {}) {
        const normalized = normalizeGetOptions(options);
        this.ensureMigrated(sessionId);
        const sessionsDir = this.locateSessionStorage(sessionId);

        if (!isSplitSession(sessionsDir, sessionId)) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        let meta = readMeta(sessionsDir, sessionId);
        const paging = {};
        if (!normalized.loadAllMessages) {
            if (normalized.beforeMessageId) {
                paging.beforeMessageId = normalized.beforeMessageId;
                paging.limit = normalized.messageLimit;
            } else if (normalized.messageLimit) {
                paging.limit = normalized.messageLimit;
            }
        }

        let { messages, totalCount, hasMoreBefore } = readMessages(
            sessionsDir,
            sessionId,
            paging,
        );

        let session = { meta, messages };

        if (sessionHasInlineImages(session)) {
            session = externalizeSessionImages(session, sessionsDir);
            this.persist(session);
            meta = session.meta;
            ({ messages, totalCount, hasMoreBefore } = readMessages(
                sessionsDir,
                sessionId,
                paging,
            ));
            session = { meta, messages };
        }

        if (normalized.hydrateImages) {
            session = hydrateSessionImages(session, sessionsDir);
            messages = session.messages;
        }

        meta = {
            ...session.meta,
            messageCount: totalCount,
            hasMoreMessages: hasMoreBefore,
            projectId: normalizeProjectId(session.meta.projectId),
        };

        return { meta, messages };
    }

    getProjectDirectory(sessionId) {
        const session = this.get(sessionId, { loadAllMessages: true, hydrateImages: false });
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
        this.ensureMigrated(sessionId);
        const sessionsDir = this.locateSessionStorage(sessionId);
        let meta = readMeta(sessionsDir, sessionId);
        const prepared = externalizeSessionImages(
            { meta, messages: [message] },
            sessionsDir,
        ).messages[0];

        appendMessageLine(sessionsDir, sessionId, prepared);

        meta = {
            ...meta,
            updatedAt: nowIso(),
            messageCount: (meta.messageCount ?? 0) + 1,
            hasUserMessages: meta.hasUserMessages || message.role === "user",
        };
        if (message.role === "user" && isDefaultSessionTitle(meta.title)) {
            const derived = titleFromFirstUserMessage(message.userText || message.content);
            if (derived) {
                meta.title = derived;
            }
        }
        writeMeta(sessionsDir, meta);
        const projectId = normalizeProjectId(meta.projectId);
        if (projectId) {
            this.syncProjectSessionName(projectId, sessionId, meta.title);
        }
        return this.get(sessionId, { loadAllMessages: true, hydrateImages: false });
    }

    removeMessages(sessionId, messageIds) {
        const idSet = new Set(messageIds);
        const session = this.get(sessionId, { loadAllMessages: true, hydrateImages: false });
        session.messages = session.messages.filter((message) => !idSet.has(message.id));
        this.save(session);
        return session;
    }

    updateModel(sessionId, providerKey, modelId) {
        const session = this.get(sessionId, { loadAllMessages: true, hydrateImages: false });
        session.meta.providerKey = providerKey;
        session.meta.modelId = modelId;
        this.save(session);
        return session;
    }

    updateTodos(sessionId, todos) {
        this.ensureMigrated(sessionId);
        const sessionsDir = this.locateSessionStorage(sessionId);
        const meta = readMeta(sessionsDir, sessionId);
        meta.todos = todos;
        meta.updatedAt = nowIso();
        writeMeta(sessionsDir, meta);
        return this.get(sessionId, { loadAllMessages: true, hydrateImages: false });
    }

    updateTodoRun(sessionId, runId, todos) {
        this.ensureMigrated(sessionId);
        const sessionsDir = this.locateSessionStorage(sessionId);
        const meta = readMeta(sessionsDir, sessionId);
        meta.todoRuns = meta.todoRuns || {};
        meta.todoRuns[runId] = {
            todos,
            updatedAt: new Date().toISOString(),
        };
        meta.todos = todos;
        meta.updatedAt = nowIso();
        writeMeta(sessionsDir, meta);
        return this.get(sessionId, { loadAllMessages: true, hydrateImages: false });
    }

    updateAuthMode(sessionId, authMode) {
        this.ensureMigrated(sessionId);
        const sessionsDir = this.locateSessionStorage(sessionId);
        const meta = readMeta(sessionsDir, sessionId);
        meta.authMode = authMode;
        meta.updatedAt = nowIso();
        writeMeta(sessionsDir, meta);
        return this.get(sessionId, { loadAllMessages: true, hydrateImages: false });
    }

    updateProject(sessionId, projectId) {
        this.ensureMigrated(sessionId);
        const normalized = normalizeProjectId(projectId);
        if (normalized) {
            const exists = this.readRawProjects().some((item) => item.id === normalized);
            if (!exists) {
                throw new Error("未找到项目");
            }
        }
        const fromDir = this.locateSessionStorage(sessionId);
        const meta = readMeta(fromDir, sessionId);
        const previousProjectId = normalizeProjectId(meta.projectId);
        const targetDir = this.resolveSessionsDirForNew(normalized);
        if (fromDir !== targetDir) {
            moveSessionStorage(fromDir, targetDir, sessionId);
        }
        meta.projectId = normalized;
        meta.updatedAt = nowIso();
        writeMeta(targetDir, meta);
        if (previousProjectId && previousProjectId !== normalized) {
            this.unregisterProjectSession(previousProjectId, sessionId);
        }
        if (normalized) {
            this.registerProjectSession(normalized, sessionId, meta.title);
        }
        return this.get(sessionId, { loadAllMessages: true, hydrateImages: false });
    }

    persist(session) {
        this.ensureMigrated(session.meta.id);
        const sessionsDir = this.locateSessionStorage(session.meta.id);
        const payload = externalizeSessionImages(session, sessionsDir);
        const meta = enrichMeta(
            { ...payload.meta, updatedAt: payload.meta.updatedAt || nowIso() },
            payload.messages,
        );
        writeMeta(sessionsDir, meta);
        rewriteMessages(sessionsDir, payload.meta.id, payload.messages);
        const projectId = normalizeProjectId(meta.projectId);
        if (projectId) {
            this.syncProjectSessionName(projectId, meta.id, meta.title);
        }
    }

    delete(sessionId) {
        let previousProjectId = null;
        let sessionsDir = null;
        try {
            sessionsDir = this.locateSessionStorage(sessionId);
            this.ensureMigrated(sessionId);
            previousProjectId = normalizeProjectId(readMeta(sessionsDir, sessionId).projectId);
        } catch {
            previousProjectId = null;
            sessionsDir = null;
        }
        if (sessionsDir) {
            deleteSessionFiles(sessionsDir, sessionId);
            deleteSessionImages(sessionId, sessionsDir);
        }
        if (previousProjectId) {
            this.unregisterProjectSession(previousProjectId, sessionId);
        }
        const remaining = this.listMetas();
        if (remaining.length) {
            return remaining[0];
        }
        return this.newSession().meta;
    }

    /** Path to append-only message log (hooks / tooling). */
    transcriptPath(sessionId) {
        this.ensureMigrated(sessionId);
        return messagesFile(this.locateSessionStorage(sessionId), sessionId);
    }
}
