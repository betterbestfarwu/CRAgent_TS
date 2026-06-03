export function normalizeProjectSessions(sessions) {
    if (!Array.isArray(sessions)) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
    for (const item of sessions) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const sessionId = String(item.sessionId || "").trim();
        if (!sessionId || seen.has(sessionId)) {
            continue;
        }
        seen.add(sessionId);
        const name = String(item.name || "").trim() || "新会话";
        normalized.push({ sessionId, name });
    }
    return normalized.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

export function indexSessionsByProjectId(metas) {
    const byProject = new Map();
    for (const meta of metas) {
        const projectId =
            typeof meta.projectId === "string" ? meta.projectId.trim() : "";
        const sessionId = String(meta.id || "").trim();
        if (!projectId || !sessionId) {
            continue;
        }
        const list = byProject.get(projectId) || [];
        list.push({
            sessionId,
            name: String(meta.title || "").trim() || "新会话",
        });
        byProject.set(projectId, list);
    }
    for (const [projectId, sessions] of byProject) {
        byProject.set(projectId, normalizeProjectSessions(sessions));
    }
    return byProject;
}

export function projectSessionsEqual(left, right) {
    const a = normalizeProjectSessions(left);
    const b = normalizeProjectSessions(right);
    if (a.length !== b.length) {
        return false;
    }
    return a.every(
        (item, index) =>
            item.sessionId === b[index].sessionId && item.name === b[index].name,
    );
}

/**
 * Align projects.json session entries with on-disk session metas.
 * - Adds missing sessions from metas
 * - Drops stale session ids not bound to the project on disk
 * - Ensures every project has a sessions array
 */
export function repairProjectRecords(projects, sessionsByProjectId, { now = () => new Date().toISOString() } = {}) {
    let changed = false;
    const repaired = projects.map((project) => {
        const expected = sessionsByProjectId.get(project.id) || [];
        const current = normalizeProjectSessions(project.sessions);
        const hadSessionsField = Array.isArray(project.sessions);
        if (!projectSessionsEqual(expected, current) || !hadSessionsField) {
            changed = true;
            return {
                ...project,
                sessions: expected,
                updatedAt: now(),
            };
        }
        return {
            ...project,
            sessions: expected,
        };
    });
    return { projects: repaired, changed };
}
