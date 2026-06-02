import fs from "node:fs";
import path from "node:path";
import { HOOKS_CONFIG_FILENAME } from "@shared/hooksConfig.js";
import { resolveSessionWorkspace } from "../workspacePaths.js";

/**
 * Resolve hooks.json for a session:
 * 1. {session workspace}/hooks.json
 * 2. {config.json directory}/hooks.json
 */
export function resolveHooksConfig({ sessionStore, configStore, sessionId }) {
    const workspace = resolveSessionWorkspace(sessionStore, configStore, sessionId);
    const workspaceFile = path.join(workspace, HOOKS_CONFIG_FILENAME);
    if (fs.existsSync(workspaceFile)) {
        return {
            hooksFile: workspaceFile,
            hookRoot: workspace,
            source: "workspace",
        };
    }

    const configDir = path.dirname(configStore.filePath);
    const configFile = path.join(configDir, HOOKS_CONFIG_FILENAME);
    if (fs.existsSync(configFile)) {
        return {
            hooksFile: configFile,
            hookRoot: configDir,
            source: "config",
        };
    }

    return {
        hooksFile: workspaceFile,
        hookRoot: workspace,
        source: "none",
    };
}

export function hooksFilePath(root) {
    return path.join(root, HOOKS_CONFIG_FILENAME);
}
