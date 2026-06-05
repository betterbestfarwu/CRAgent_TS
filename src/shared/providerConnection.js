export function hasValidProviderApiKey(apiKey) {
    const key = String(apiKey || "").trim();
    return key.length > 0 && !key.includes("REPLACE_ME");
}

export function validateProviderConnectionFields(connection) {
    const baseUrl = String(connection?.baseUrl ?? "").trim();
    const apiKey = String(connection?.apiKey ?? "").trim();
    if (!baseUrl) {
        return { ok: false, error: "Base URL 不能为空" };
    }
    if (!hasValidProviderApiKey(apiKey)) {
        return { ok: false, error: "请先配置有效 API Key" };
    }
    return { ok: true };
}

export function applyProviderConnection(existing, connection) {
    if (!connection) {
        return existing;
    }
    return {
        ...existing,
        baseUrl: connection.baseUrl ?? "",
        apiKey: connection.apiKey ?? "",
        api: connection.api ?? existing.api ?? "",
    };
}
