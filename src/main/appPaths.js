import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { projectsStorageRoot } from "@shared/projectStoragePaths.js";

export function getAppPaths() {
    const root = path.join(os.homedir(), ".CRAgent");
    const sessionsDir = path.join(root, "sessions");
    const projectsDir = projectsStorageRoot(root);
    const configFile = path.join(root, "config.json");
    const projectsFile = path.join(root, "projects.json");
    const skillsDir = path.join(root, "skills");
    const memoryDir = path.join(root, "memory");
    const logDir = path.join(root, "Log");
    for (const p of [root, sessionsDir, projectsDir, skillsDir, memoryDir, logDir]) {
        if (!fs.existsSync(p)) {
            fs.mkdirSync(p, { recursive: true });
        }
    }
    return { root, sessionsDir, projectsDir, configFile, projectsFile, skillsDir, memoryDir, logDir };
}
