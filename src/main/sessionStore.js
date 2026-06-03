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
    metaFile,
    migrateLegacySessionIfNeeded,
    readLegacyMeta,
    readMessages,
    readMeta,
    rewriteMessages,
    writeMeta,
    writeSplitSession,
} from "./sessionStorage.js";
import {
    deleteSessionImages,
    externalizeSessionImages,
    hydrateSessionImages,
    sessionHasInlineImages,
} from "./sessionImageStorage.js";

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
    constructor(sessionsDir, defaultModel, projectsFile) {
        this.sessionsDir = sessionsDir;
        this.defaultModel = defaultModel;
        this.projectsFile = projectsFile;
        fs.mkdirSync(this.sessionsDir, { recursive: true });
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
            metas.push({
                ...meta,
                projectId: normalizeProjectId(meta.projectId),
            });
        }
        if (metas.length === 0) {
            return [this.newSession().meta];
        }
        return metas;
    }

    ensureMigrated(sessionId) {
        migrateLegacySessionIfNeeded(this.sessionsDir, sessionId);
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
        writeMeta(this.sessionsDir, meta);
        return { meta, messages: [] };
    }

    get(sessionId, options = {}) {
        const normalized = normalizeGetOptions(options);
        this.ensureMigrated(sessionId);

        if (!isSplitSession(this.sessionsDir, sessionId)) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        let meta = readMeta(this.sessionsDir, sessionId);
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
            this.sessionsDir,
            sessionId,
            paging,
        );

        let session = { meta, messages };

        if (sessionHasInlineImages(session)) {
            session = externalizeSessionImages(session, this.sessionsDir);
            this.persist(session);
            meta = session.meta;
            ({ messages, totalCount, hasMoreBefore } = readMessages(
                this.sessionsDir,
                sessionId,
                paging,
            ));
            session = { meta, messages };
        }

        if (normalized.hydrateImages) {
            session = hydrateSessionImages(session, this.sessionsDir);
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
        let meta = readMeta(this.sessionsDir, sessionId);
        const prepared = externalizeSessionImages(
            { meta, messages: [message] },
            this.sessionsDir,
        ).messages[0];

        appendMessageLine(this.sessionsDir, sessionId, prepared);

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
        writeMeta(this.sessionsDir, meta);
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
        const meta = readMeta(this.sessionsDir, sessionId);
        meta.todos = todos;
        meta.updatedAt = nowIso();
        writeMeta(this.sessionsDir, meta);
        return this.get(sessionId, { loadAllMessages: true, hydrateImages: false });
    }

    updateTodoRun(sessionId, runId, todos) {
        this.ensureMigrated(sessionId);
        const meta = readMeta(this.sessionsDir, sessionId);
        meta.todoRuns = meta.todoRuns || {};
        meta.todoRuns[runId] = {
            todos,
            updatedAt: new Date().toISOString(),
        };
        meta.todos = todos;
        meta.updatedAt = nowIso();
        writeMeta(this.sessionsDir, meta);
        return this.get(sessionId, { loadAllMessages: true, hydrateImages: false });
    }

    updateAuthMode(sessionId, authMode) {
        this.ensureMigrated(sessionId);
        const meta = readMeta(this.sessionsDir, sessionId);
        meta.authMode = authMode;
        meta.updatedAt = nowIso();
        writeMeta(this.sessionsDir, meta);
        return this.get(sessionId, { loadAllMessages: true, hydrateImages: false });
    }

    persist(session) {
        this.ensureMigrated(session.meta.id);
        const payload = externalizeSessionImages(session, this.sessionsDir);
        const meta = enrichMeta(
            { ...payload.meta, updatedAt: payload.meta.updatedAt || nowIso() },
            payload.messages,
        );
        writeMeta(this.sessionsDir, meta);
        rewriteMessages(this.sessionsDir, payload.meta.id, payload.messages);
    }

    delete(sessionId) {
        deleteSessionFiles(this.sessionsDir, sessionId);
        deleteSessionImages(sessionId, this.sessionsDir);
        const remaining = this.listMetas();
        if (remaining.length) {
            return remaining[0];
        }
        return this.newSession().meta;
    }

    /** Path to append-only message log (hooks / tooling). */
    transcriptPath(sessionId) {
        this.ensureMigrated(sessionId);
        return messagesFile(this.sessionsDir, sessionId);
    }
}
