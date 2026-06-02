import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOOKS_CONFIG_FILENAME } from "../src/shared/hooksConfig.js";
import { ConfigStore } from "../src/main/configStore.js";
import { resolveHooksConfig } from "../src/main/hooks/hookPaths.js";
import { SessionStore } from "../src/main/sessionStore.js";

describe("resolveHooksConfig", () => {
    it("prefers hooks.json in session workspace", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-hook-resolve-"));
        const configFile = path.join(dir, "config.json");
        const sessionsDir = path.join(dir, "sessions");
        const projectsFile = path.join(dir, "projects.json");
        fs.mkdirSync(sessionsDir, { recursive: true });

        const configStore = new ConfigStore(configFile);
        fs.writeFileSync(
            path.join(dir, HOOKS_CONFIG_FILENAME),
            JSON.stringify({ version: 1, hooks: {} }),
        );

        const sessionStore = new SessionStore(sessionsDir, configStore.resolvePrimaryRef(), projectsFile);
        const projectPath = path.join(dir, "proj");
        fs.mkdirSync(projectPath, { recursive: true });
        fs.writeFileSync(
            path.join(projectPath, HOOKS_CONFIG_FILENAME),
            JSON.stringify({ version: 1, hooks: { PreToolUse: [] } }),
        );
        const project = sessionStore.addProject(projectPath);
        const session = sessionStore.newSession({ projectId: project.id });

        const resolved = resolveHooksConfig({
            sessionStore,
            configStore,
            sessionId: session.meta.id,
        });

        assert.equal(resolved.source, "workspace");
        assert.equal(resolved.hooksFile, path.join(projectPath, HOOKS_CONFIG_FILENAME));
        assert.equal(resolved.hookRoot, projectPath);
    });

    it("falls back to config.json directory when workspace has no hooks.json", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cragent-hook-fallback-"));
        const configFile = path.join(dir, "config.json");
        const sessionsDir = path.join(dir, "sessions");
        const workspaceDir = path.join(dir, "agent-workspace");
        fs.mkdirSync(sessionsDir, { recursive: true });
        fs.mkdirSync(workspaceDir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, HOOKS_CONFIG_FILENAME),
            JSON.stringify({ version: 1, hooks: { Stop: [] } }),
        );

        const configStore = new ConfigStore(configFile);
        configStore.update({
            ...configStore.get(),
            agents: {
                ...configStore.get().agents,
                default: {
                    ...configStore.get().agents.default,
                    workspace: workspaceDir,
                },
            },
        });
        const sessionStore = new SessionStore(sessionsDir, configStore.resolvePrimaryRef());
        const session = sessionStore.newSession();

        const resolved = resolveHooksConfig({
            sessionStore,
            configStore,
            sessionId: session.meta.id,
        });

        assert.equal(resolved.source, "config");
        assert.equal(resolved.hooksFile, path.join(dir, HOOKS_CONFIG_FILENAME));
        assert.equal(resolved.hookRoot, dir);
    });
});
