import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    getPlanFilePath,
    resolvePlanToolPath,
} from "./sessionPlanPaths.js";

export const WORKSPACE_CRAGENT_DIR = ".cragent";

function expandTilde(input) {
    const raw = String(input || "").trim();
    if (raw === "~") {
        return os.homedir();
    }
    if (raw.startsWith("~/")) {
        return path.join(os.homedir(), raw.slice(2));
    }
    return raw;
}

export function workspaceCragentRoot(workspace) {
    const root = String(workspace || "").trim();
    if (!root) {
        return "";
    }
    return path.normalize(path.join(path.resolve(expandTilde(root)), WORKSPACE_CRAGENT_DIR));
}

export function isPathUnderWorkspaceCragent(workspace, resolvedPath) {
    const cragentRoot = workspaceCragentRoot(workspace);
    if (!cragentRoot) {
        return false;
    }
    const target = path.normalize(resolvedPath);
    return target === cragentRoot || target.startsWith(`${cragentRoot}${path.sep}`);
}

/**
 * Redirect workspace `.cragent/...` tool paths to `sessionsDir/<sessionId>/...`.
 * Plan aliases are handled first (including legacy `.cragent/plans/<id>.md`).
 */
export function resolveSessionStorageToolPath(rawPath, { workspace, sessionsDir, sessionId, planFilePath }) {
    const cleanSessionId = String(sessionId || "").trim();
    if (!cleanSessionId || !sessionsDir) {
        return null;
    }
    if (planFilePath) {
        const plan = resolvePlanToolPath(rawPath, {
            planFilePath,
            workspace,
            sessionId: cleanSessionId,
        });
        if (plan) {
            return plan;
        }
    }
    const workspaceRoot = String(workspace || "").trim();
    if (!workspaceRoot) {
        return null;
    }
    const raw = String(rawPath || "").trim();
    if (!raw) {
        return null;
    }
    const expanded = expandTilde(raw);
    const resolved = path.isAbsolute(expanded)
        ? path.normalize(path.resolve(expanded))
        : path.normalize(path.resolve(workspaceRoot, expanded));
    if (!isPathUnderWorkspaceCragent(workspaceRoot, resolved)) {
        return null;
    }
    const cragentRoot = workspaceCragentRoot(workspaceRoot);
    const relative = path.relative(cragentRoot, resolved);
    const sessionRoot = path.join(sessionsDir, cleanSessionId);
    const legacyPlanRel = path.join("plans", `${cleanSessionId}.md`);
    if (relative === legacyPlanRel) {
        return getPlanFilePath(sessionsDir, cleanSessionId);
    }
    if (!relative || relative === ".") {
        return sessionRoot;
    }
    return path.join(sessionRoot, relative);
}

export function goalModeBashBlocksWorkspaceCragent(command) {
    const cmd = String(command || "");
    if (!cmd.includes(".cragent")) {
        return null;
    }
    const writes =
        /\s>>?\s/.test(cmd) ||
        /(^|[\s;|])>/.test(cmd) ||
        /\|\s*tee\b/i.test(cmd) ||
        /\b(mkdir|touch|cp|mv|rm)\b/i.test(cmd);
    if (!writes) {
        return null;
    }
    return (
        "Goal 模式禁止向工作区 .cragent 目录写入。请使用 write_file，路径使用 plan.md " +
        "或相对会话数据目录的文件名（普通会话实际保存在 ~/.CRAgent/sessions/<sessionsRootGuid>/<sessionId>/ 下，" +
        "项目会话实际保存在 ~/.CRAgent/sessions/<projectsRootGuid>/<projectId>/<sessionId>/ 下）。"
    );
}
