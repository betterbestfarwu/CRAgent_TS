import path from "node:path";

export function projectsStorageRoot(appRoot) {
    return path.join(appRoot, "Projects");
}

export function projectStorageRoot(projectsDir, projectId) {
    return path.join(projectsDir, String(projectId || "").trim());
}

export function projectSessionsDir(projectsDir, projectId) {
    return path.join(projectStorageRoot(projectsDir, projectId), "sessions");
}
