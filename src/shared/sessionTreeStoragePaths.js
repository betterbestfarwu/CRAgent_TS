import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SESSION_TREE_LAYOUT_DIR = "_layout";
export const SESSION_TREE_LAYOUT_FILENAME = "tree.json";

export function sessionTreeLayoutFile(sessionsDir) {
    return path.join(sessionsDir, SESSION_TREE_LAYOUT_DIR, SESSION_TREE_LAYOUT_FILENAME);
}

export function normalizeLayoutId(value) {
    const id = String(value || "").trim();
    return id || null;
}

export function ensureSessionTreeLayout(sessionsDir) {
    fs.mkdirSync(sessionsDir, { recursive: true });
    const file = sessionTreeLayoutFile(sessionsDir);
    let parsed = {};
    if (fs.existsSync(file)) {
        try {
            parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
        } catch {
            parsed = {};
        }
    }

    let sessionsRootId = normalizeLayoutId(parsed.sessionsRootId);
    let projectsRootId = normalizeLayoutId(parsed.projectsRootId);
    if (!sessionsRootId) {
        sessionsRootId = randomUUID();
    }
    if (!projectsRootId || projectsRootId === sessionsRootId) {
        projectsRootId = randomUUID();
    }

    const layout = { sessionsRootId, projectsRootId };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(layout, null, 2), {
        encoding: "utf-8",
        mode: 0o644,
    });
    return layout;
}

export function standaloneSessionsDir(sessionsDir, layout) {
    return path.join(sessionsDir, layout.sessionsRootId);
}

export function projectTreeRootDir(sessionsDir, layout) {
    return path.join(sessionsDir, layout.projectsRootId);
}

export function projectSessionsDir(sessionsDir, layout, projectId) {
    return path.join(projectTreeRootDir(sessionsDir, layout), String(projectId || "").trim());
}

export function legacyProjectsStorageRoot(sessionsDir) {
    return path.join(path.dirname(sessionsDir), "Projects");
}
