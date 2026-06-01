const TODO_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);

export function normalizeTodo(item) {
    const id = String(item?.id || "").trim();
    const content = String(item?.content || "").trim();
    const status = TODO_STATUSES.has(item?.status) ? item.status : "pending";
    const activeForm = String(item?.activeForm || "").trim();
    if (!id || !content) {
        return null;
    }
    return activeForm ? { id, content, status, activeForm } : { id, content, status };
}

export function mergeTodos(existing, incoming, merge) {
    const normalizedIncoming = incoming.map(normalizeTodo).filter(Boolean);
    if (!merge) {
        return normalizedIncoming;
    }
    const byId = new Map((existing || []).map((item) => [item.id, item]));
    for (const item of normalizedIncoming) {
        byId.set(item.id, item);
    }
    return [...byId.values()];
}

export function formatTodosForPrompt(todos) {
    if (!todos?.length) {
        return "";
    }
    const lines = todos.map((item) => {
        const label =
            item.status === "in_progress" && item.activeForm
                ? `${item.content} (${item.activeForm})`
                : item.content;
        return `- [${item.status}] ${item.id}: ${label}`;
    });
    return `<active_todos>\n${lines.join("\n")}\n</active_todos>`;
}
