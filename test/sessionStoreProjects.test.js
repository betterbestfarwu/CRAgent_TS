import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "../src/main/sessionStore.js";
import { sessionDir, writeMeta } from "../src/main/sessionStorage.js";

describe("SessionStore.removeProject", () => {
    it("deletes project sessions and session data instead of detaching", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-remove-project-"));
        const sessionsDir = path.join(dir, "sessions");
        const projectsDir = path.join(dir, "Projects");
        const projectsFile = path.join(dir, "projects.json");
        fs.mkdirSync(sessionsDir, { recursive: true });

        const projectPath = path.join(dir, "subproj");
        fs.mkdirSync(projectPath, { recursive: true });

        const store = new SessionStore(
            sessionsDir,
            { providerKey: "openai", modelId: "gpt-4o-mini" },
            projectsFile,
            projectsDir,
        );
        const project = store.addProject(projectPath);
        const projectSession = store.newSession({ projectId: project.id });
        const globalSession = store.newSession();
        const layout = store.sessionTreeLayout;
        const projectSessionsRoot = path.join(sessionsDir, layout.projectsRootId, project.id);
        const standaloneRoot = path.join(sessionsDir, layout.sessionsRootId);
        assert.equal(
            fs.existsSync(sessionDir(projectSessionsRoot, projectSession.meta.id)),
            true,
        );
        assert.equal(
            fs.existsSync(sessionDir(standaloneRoot, globalSession.meta.id)),
            true,
        );

        const projectsOnDisk = JSON.parse(fs.readFileSync(projectsFile, "utf-8"));
        assert.equal(projectsOnDisk[0].sessions.length, 1);
        assert.equal(projectsOnDisk[0].sessions[0].sessionId, projectSession.meta.id);
        assert.equal(projectsOnDisk[0].sessions[0].name, "新会话");

        const result = store.removeProject(project.id);

        assert.deepEqual(result.deletedSessionIds, [projectSession.meta.id]);
        assert.ok(result.fallbackSessionId);
        assert.equal(store.listProjects().length, 0);
        assert.equal(
            store.listMetas().some((meta) => meta.id === projectSession.meta.id),
            false,
        );
        assert.equal(fs.existsSync(path.join(sessionsDir, layout.projectsRootId, project.id)), false);
        assert.equal(
            store.listMetas().some((meta) => meta.id === globalSession.meta.id),
            true,
        );
    });

    it("updates project sessions name when session title changes", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-project-session-name-"));
        const sessionsDir = path.join(dir, "sessions");
        const projectsDir = path.join(dir, "Projects");
        const projectsFile = path.join(dir, "projects.json");
        fs.mkdirSync(sessionsDir, { recursive: true });

        const store = new SessionStore(
            sessionsDir,
            { providerKey: "openai", modelId: "gpt-4o-mini" },
            projectsFile,
            projectsDir,
        );
        const projectPath = path.join(dir, "proj");
        fs.mkdirSync(projectPath, { recursive: true });
        const project = store.addProject(projectPath);
        const session = store.newSession({ projectId: project.id });
        store.appendMessage(session.meta.id, {
            id: "u1",
            role: "user",
            content: "hello world",
            userText: "hello world",
            createdAt: new Date().toISOString(),
        });

        const projectsOnDisk = JSON.parse(fs.readFileSync(projectsFile, "utf-8"));
        assert.equal(projectsOnDisk[0].sessions[0].name, "hello world");
    });

    it("uses the first assistant sentence for image-only session titles", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-project-assistant-title-"));
        const sessionsDir = path.join(dir, "sessions");
        const projectsDir = path.join(dir, "Projects");
        const projectsFile = path.join(dir, "projects.json");
        fs.mkdirSync(sessionsDir, { recursive: true });

        const store = new SessionStore(
            sessionsDir,
            { providerKey: "openai", modelId: "gpt-4o-mini" },
            projectsFile,
            projectsDir,
        );
        const projectPath = path.join(dir, "proj");
        fs.mkdirSync(projectPath, { recursive: true });
        const project = store.addProject(projectPath);
        const session = store.newSession({ projectId: project.id });
        store.appendMessage(session.meta.id, {
            id: "u1",
            role: "user",
            content: "",
            userText: "",
            images: [{ id: "img1", mimeType: "image/png", dataUrl: "data:image/png;base64,QUJD" }],
            createdAt: new Date().toISOString(),
        });

        const afterAssistant = store.appendMessage(session.meta.id, {
            id: "a1",
            role: "assistant",
            content: "这张图显示了登录错误。建议先检查账号状态。",
            createdAt: new Date().toISOString(),
        });

        const projectsOnDisk = JSON.parse(fs.readFileSync(projectsFile, "utf-8"));
        assert.equal(afterAssistant.meta.title, "这张图显示了登录错误");
        assert.equal(projectsOnDisk[0].sessions[0].name, "这张图显示了登录错误");
    });

    it("migrates legacy project sessions out of the global sessions dir", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-migrate-project-sessions-"));
        const sessionsDir = path.join(dir, "sessions");
        const projectsDir = path.join(dir, "Projects");
        const projectsFile = path.join(dir, "projects.json");
        fs.mkdirSync(sessionsDir, { recursive: true });

        const projectPath = path.join(dir, "workspace");
        fs.mkdirSync(projectPath, { recursive: true });
        const legacySessionId = "legacy-project-session";
        const timestamp = new Date().toISOString();
        writeMeta(sessionsDir, {
            id: legacySessionId,
            title: "新会话",
            providerKey: "openai",
            modelId: "gpt-4o-mini",
            projectId: "pending-project-id",
            createdAt: timestamp,
            updatedAt: timestamp,
            todos: [],
        });
        fs.writeFileSync(
            projectsFile,
            JSON.stringify(
                [
                    {
                        id: "pending-project-id",
                        name: "workspace",
                        directoryPath: projectPath,
                        createdAt: timestamp,
                        updatedAt: timestamp,
                        sessions: [{ sessionId: legacySessionId, name: "新会话" }],
                    },
                ],
                null,
                2,
            ),
        );

        const migratedStore = new SessionStore(
            sessionsDir,
            { providerKey: "openai", modelId: "gpt-4o-mini" },
            projectsFile,
            projectsDir,
        );
        const layout = migratedStore.sessionTreeLayout;
        const projectSessionsRoot = path.join(
            sessionsDir,
            layout.projectsRootId,
            "pending-project-id",
        );

        assert.equal(fs.existsSync(sessionDir(sessionsDir, legacySessionId)), false);
        assert.equal(
            fs.existsSync(sessionDir(projectSessionsRoot, legacySessionId)),
            true,
        );
    });

    it("migrates legacy project tree sessions into the GUID project root", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-migrate-project-tree-"));
        const sessionsDir = path.join(dir, "sessions");
        const projectsDir = path.join(dir, "Projects");
        const projectsFile = path.join(dir, "projects.json");
        fs.mkdirSync(sessionsDir, { recursive: true });

        const projectPath = path.join(dir, "workspace");
        fs.mkdirSync(projectPath, { recursive: true });
        const projectId = "pending-project-id";
        const legacySessionId = "legacy-project-session";
        const timestamp = new Date().toISOString();
        const legacyProjectSessionsRoot = path.join(projectsDir, projectId, "sessions");
        writeMeta(legacyProjectSessionsRoot, {
            id: legacySessionId,
            title: "新会话",
            providerKey: "openai",
            modelId: "gpt-4o-mini",
            projectId,
            createdAt: timestamp,
            updatedAt: timestamp,
            todos: [],
        });
        fs.writeFileSync(
            projectsFile,
            JSON.stringify(
                [
                    {
                        id: projectId,
                        name: "workspace",
                        directoryPath: projectPath,
                        createdAt: timestamp,
                        updatedAt: timestamp,
                        sessions: [{ sessionId: legacySessionId, name: "新会话" }],
                    },
                ],
                null,
                2,
            ),
        );

        const migratedStore = new SessionStore(
            sessionsDir,
            { providerKey: "openai", modelId: "gpt-4o-mini" },
            projectsFile,
            projectsDir,
        );
        const layout = migratedStore.sessionTreeLayout;
        const projectSessionsRoot = path.join(sessionsDir, layout.projectsRootId, projectId);

        assert.equal(fs.existsSync(sessionDir(legacyProjectSessionsRoot, legacySessionId)), false);
        assert.equal(
            fs.existsSync(sessionDir(projectSessionsRoot, legacySessionId)),
            true,
        );
    });
});
