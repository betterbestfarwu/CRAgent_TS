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

function resolveExistingRealpath(rawPath) {
    const resolved = path.resolve(String(rawPath || ""));
    try {
        return fs.realpathSync(resolved);
    } catch (error) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
        const parent = path.dirname(resolved);
        if (parent === resolved) {
            return resolved;
        }
        return path.join(resolveExistingRealpath(parent), path.basename(resolved));
    }
}

export function assertPathContainedInRoot(root, target) {
    const resolvedRoot = resolveExistingRealpath(root);
    const resolvedTarget = resolveExistingRealpath(target);
    if (
        resolvedTarget !== resolvedRoot &&
        !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
    ) {
        throw new Error("path must stay inside workspace");
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
    assertPathContainedInRoot(workspace, resolved);
    return resolved;
}

export function resolveCwd(workspace, rawCwd) {
    if (!rawCwd || !String(rawCwd).trim()) {
        return workspace;
    }
    return resolvePathInWorkspace(workspace, rawCwd);
}
