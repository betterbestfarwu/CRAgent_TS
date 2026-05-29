const TODO_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);

export function normalizeTodo(item) {
    const id = String(item?.id || "").trim();
    const content = String(item?.content || "").trim();
    const status = TODO_STATUSES.has(item?.status) ? item.status : "pending";
    if (!id || !content) {
        return null;
    }
    return { id, content, status };
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
    const lines = todos.map((item) => `- [${item.status}] ${item.id}: ${item.content}`);
    return `<active_todos>\n${lines.join("\n")}\n</active_todos>`;
}
