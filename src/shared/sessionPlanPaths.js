import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PLAN_FILENAME = "plan.md";
/** @deprecated Legacy workspace-relative plan directory */
export const LEGACY_WORKSPACE_PLANS_DIR = ".cragent/plans";

export function getPlanFilePath(sessionsDir, sessionId) {
    return path.join(sessionsDir, String(sessionId || "").trim(), PLAN_FILENAME);
}

export function getPlanDisplayPath() {
    return PLAN_FILENAME;
}

export function getLegacyWorkspacePlanPath(workspace, sessionId) {
    return path.join(workspace, LEGACY_WORKSPACE_PLANS_DIR, `${sessionId}.md`);
}

export function migrateLegacyWorkspacePlan(workspace, sessionsDir, sessionId) {
    const cleanId = String(sessionId || "").trim();
    if (!cleanId || !sessionsDir) {
        return;
    }
    const target = getPlanFilePath(sessionsDir, cleanId);
    if (fs.existsSync(target)) {
        return;
    }
    const legacyWorkspace = String(workspace || "").trim();
    if (!legacyWorkspace) {
        return;
    }
    const legacy = getLegacyWorkspacePlanPath(legacyWorkspace, cleanId);
    if (!fs.existsSync(legacy)) {
        return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(legacy, target);
}

export function ensureSessionPlanFile(sessionsDir, sessionId, workspace = null) {
    migrateLegacyWorkspacePlan(workspace, sessionsDir, sessionId);
    const dir = path.join(sessionsDir, String(sessionId || "").trim());
    fs.mkdirSync(dir, { recursive: true });
    return getPlanFilePath(sessionsDir, sessionId);
}

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

/** Map plan-mode tool paths (including legacy .cragent/plans) to the session plan file. */
export function resolvePlanToolPath(rawPath, { planFilePath, workspace, sessionId }) {
    const raw = String(rawPath || "").trim();
    if (!raw || !planFilePath || !sessionId) {
        return null;
    }
    const canonical = path.normalize(planFilePath);
    let resolved;
    const expanded = expandTilde(raw);
    if (path.isAbsolute(expanded)) {
        resolved = path.normalize(path.resolve(expanded));
    } else if (workspace) {
        resolved = path.normalize(path.resolve(workspace, expanded));
    } else {
        return null;
    }
    const aliases = new Set([
        canonical,
        path.normalize(getLegacyWorkspacePlanPath(workspace || "", sessionId)),
        path.normalize(path.join(workspace || "", PLAN_FILENAME)),
        path.normalize(path.join(workspace || "", LEGACY_WORKSPACE_PLANS_DIR, `${sessionId}.md`)),
    ]);
    return aliases.has(resolved) ? planFilePath : null;
}
