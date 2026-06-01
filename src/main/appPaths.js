import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export function getAppPaths() {
    const root = path.join(os.homedir(), ".CRAgent");
    const sessionsDir = path.join(root, "sessions");
    const configFile = path.join(root, "config.json");
    const projectsFile = path.join(root, "projects.json");
    const skillsDir = path.join(root, "skills");
    const memoryDir = path.join(root, "memory");
    for (const p of [root, sessionsDir, skillsDir, memoryDir]) {
        if (!fs.existsSync(p)) {
            fs.mkdirSync(p, { recursive: true });
        }
    }
    return { root, sessionsDir, configFile, projectsFile, skillsDir, memoryDir };
}
