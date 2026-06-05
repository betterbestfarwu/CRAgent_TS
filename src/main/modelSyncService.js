import { hasValidProviderApiKey } from "@shared/providerConnection.js";

function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || "").replace(/\/+$/, "");
}

function extractModelIds(payload) {
    if (!payload) return [];
    if (Array.isArray(payload.data)) {
        return payload.data
            .map((item) => item?.id || item?.name)
            .filter(Boolean);
    }
    if (Array.isArray(payload.models)) {
        return payload.models
            .map((item) => (typeof item === "string" ? item : item?.id || item?.name))
            .filter(Boolean);
    }
    return [];
}

function createModelEntry(id, previous) {
    if (previous) {
        return {
            ...previous,
            id,
            name: previous.name || id,
        };
    }
    return {
        id,
        name: id,
        description: "",
        reasoning: false,
        input: ["text"],
        cost: {},
        contextWindow: 128000,
        maxTokens: 8192,
        state: false,
        stream: false,
    };
}

export async function fetchProviderModelIds(provider) {
    const baseUrl = normalizeBaseUrl(provider?.baseUrl);
    const apiKey = provider?.apiKey || "";
    if (!baseUrl) {
        throw new Error("Base URL 不能为空");
    }
    if (!hasValidProviderApiKey(apiKey)) {
        throw new Error("请先配置有效 API Key");
    }

    const response = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`拉取模型失败: ${response.status} ${text.slice(0, 200)}`);
    }

    const payload = await response.json();
    const ids = [...new Set(extractModelIds(payload))].sort((a, b) =>
        a.localeCompare(b),
    );
    if (ids.length === 0) {
        throw new Error("接口未返回可用模型");
    }
    return ids;
}

export function mergeProviderModels(provider, remoteIds) {
    const previousById = new Map((provider.models || []).map((model) => [model.id, model]));
    return {
        ...provider,
        models: remoteIds.map((id) => createModelEntry(id, previousById.get(id))),
    };
}
