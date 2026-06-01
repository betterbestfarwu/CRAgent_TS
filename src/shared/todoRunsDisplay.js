/** Filter todo run snapshots shown in chat (hide stale all-completed lists). */

export const COMPLETED_TODO_HIDE_MS = 5000;

export function filterVisibleTodoRuns(todoRuns, now = Date.now()) {
    if (!todoRuns || typeof todoRuns !== "object") {
        return {};
    }

    const visible = {};
    for (const [runId, entry] of Object.entries(todoRuns)) {
        const todos = entry?.todos || [];
        const active = todos.filter((item) => item.status !== "cancelled");
        if (!active.length) {
            continue;
        }
        const allCompleted = active.every((item) => item.status === "completed");
        if (allCompleted && entry.updatedAt) {
            const age = now - new Date(entry.updatedAt).getTime();
            if (age >= COMPLETED_TODO_HIDE_MS) {
                continue;
            }
        }
        visible[runId] = entry;
    }
    return visible;
}

/** Milliseconds until the next completed todo list should disappear, or null. */
export function msUntilTodoRunsHide(todoRuns, now = Date.now()) {
    if (!todoRuns || typeof todoRuns !== "object") {
        return null;
    }

    let nextDelay = null;
    for (const entry of Object.values(todoRuns)) {
        const todos = entry?.todos || [];
        const active = todos.filter((item) => item.status !== "cancelled");
        if (!active.length || !active.every((item) => item.status === "completed")) {
            continue;
        }
        if (!entry.updatedAt) {
            continue;
        }
        const remaining = COMPLETED_TODO_HIDE_MS - (now - new Date(entry.updatedAt).getTime());
        if (remaining > 0 && (nextDelay === null || remaining < nextDelay)) {
            nextDelay = remaining;
        }
    }
    return nextDelay;
}
