#!/usr/bin/env node
/**
 * Backfill projects.json "sessions" from on-disk session metas.
 *
 * Usage:
 *   node --import ./test/register-test.mjs scripts/migrate-projects-json.mjs
 */

import { getAppPaths } from "../src/main/appPaths.js";
import { SessionStore } from "../src/main/sessionStore.js";

const appPaths = getAppPaths();
const store = new SessionStore(
    appPaths.sessionsDir,
    { providerKey: "openai", modelId: "gpt-4o-mini" },
    appPaths.projectsFile,
    appPaths.projectsDir,
);

const result = store.repairProjectsFile();
const projects = store.readRawProjects();

console.log(
    result.changed
        ? `Updated ${appPaths.projectsFile}`
        : `No changes needed for ${appPaths.projectsFile}`,
);
for (const project of projects) {
    console.log(
        `- ${project.name}: ${project.sessions.length} session(s)`,
    );
}
