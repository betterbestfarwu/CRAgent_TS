import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandTilde(input) {
    const raw = String(input || "").trim();
    if (raw === "~") {
        return os.homedir();
    }
    if (raw.startsWith("~/")) {
        return path.join(os.homedir(), raw.slice(2));
    }
    return raw;
}

export function resolveWorkspace(configStore) {
    const configured = configStore.get().agents?.default?.workspace?.trim() || "";
    const workspace = configured
        ? path.resolve(expandTilde(configured))
        : path.join(os.homedir(), ".CRAgent");
    if (!fs.existsSync(workspace)) {
        fs.mkdirSync(workspace, { recursive: true });
    }
    return workspace;
}

export function resolveSessionWorkspace(sessionStore, configStore, sessionId) {
    const fallback = resolveWorkspace(configStore);
    if (!sessionId || !sessionStore) {
        return fallback;
    }
    try {
        const projectRoot = sessionStore.getProjectDirectory?.(sessionId);
        if (!projectRoot) {
            return fallback;
        }
        const resolved = path.resolve(expandTilde(projectRoot));
        if (!fs.existsSync(resolved)) {
            return fallback;
        }
        return resolved;
    } catch {
        return fallback;
    }
}

export function resolvePathInWorkspace(workspace, rawPath) {
    const raw = String(rawPath || "").trim();
    if (!raw) {
        throw new Error("'path' is required");
    }
    const expanded = expandTilde(raw);
    const resolved = path.isAbsolute(expanded)
        ? path.resolve(expanded)
        : path.resolve(workspace, expanded);
    const root = path.resolve(workspace);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error("path must stay inside workspace");
    }
    return resolved;
}

export function resolveCwd(workspace, rawCwd) {
    if (!rawCwd || !String(rawCwd).trim()) {
        return workspace;
    }
    return resolvePathInWorkspace(workspace, rawCwd);
}
