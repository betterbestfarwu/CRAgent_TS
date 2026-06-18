function modelRefUsesProvider(ref, providerKey) {
    return typeof ref === "string" && ref.startsWith(`${providerKey}/`);
}

function replaceProviderRef(ref, oldKey, newKey) {
    const prefix = `${oldKey}/`;
    if (typeof ref === "string" && ref.startsWith(prefix)) {
        return `${newKey}/${ref.slice(prefix.length)}`;
    }
    return ref;
}

export function firstModelRef(models) {
    for (const [providerKey, provider] of Object.entries(models || {})) {
        for (const model of provider.models || []) {
            if (model.state) return `${providerKey}/${model.id}`;
        }
    }
    for (const [providerKey, provider] of Object.entries(models || {})) {
        const first = provider.models?.[0];
        if (first) return `${providerKey}/${first.id}`;
    }
    return "";
}

export function firstEnabledModelRef(models) {
    for (const [providerKey, provider] of Object.entries(models || {})) {
        for (const model of provider.models || []) {
            if (model.state) {
                return `${providerKey}/${model.id}`;
            }
        }
    }
    return "";
}

export function resolvePrimaryModelRef(models, primaryRef) {
    const primary = String(primaryRef || "").trim();
    if (primary) {
        return primary;
    }
    return firstEnabledModelRef(models);
}

export function prepareDefaultAgentConfigForSave(config) {
    const baseConfig = config || {};
    const defaultModel = baseConfig.agents?.default?.model || {};
    const primary = resolvePrimaryModelRef(baseConfig.models, defaultModel.primary);
    if (!primary) {
        return {
            config: baseConfig,
            error: "请先在 Models 页启用至少一个模型，再保存 Agent 设置。",
        };
    }
    if (primary === defaultModel.primary) {
        return { config: baseConfig, error: "" };
    }
    const nextFallbacks = (defaultModel.fallbacks || []).filter((ref) => ref !== primary);
    return {
        config: {
            ...baseConfig,
            agents: {
                ...baseConfig.agents,
                default: {
                    ...baseConfig.agents?.default,
                    model: {
                        ...defaultModel,
                        primary,
                        fallbacks: nextFallbacks,
                    },
                },
            },
        },
        error: "",
    };
}

export function removeProviderFromConfig(config, providerKey) {
    if (!providerKey || !config?.models?.[providerKey]) {
        return config;
    }
    const { [providerKey]: _removed, ...restModels } = config.models;
    const defaultModel = config.agents?.default?.model || {};
    let nextPrimary = defaultModel.primary || "";
    if (modelRefUsesProvider(nextPrimary, providerKey)) {
        nextPrimary = firstModelRef(restModels);
    }
    const nextFallbacks = (defaultModel.fallbacks || []).filter(
        (ref) => !modelRefUsesProvider(ref, providerKey),
    );
    return {
        ...config,
        models: restModels,
        agents: {
            ...config.agents,
            default: {
                ...config.agents.default,
                model: {
                    ...defaultModel,
                    primary: nextPrimary,
                    fallbacks: nextFallbacks,
                },
            },
        },
    };
}

export function renameProviderInConfig(config, oldKey, newKey) {
    if (!oldKey || !newKey || oldKey === newKey || !config?.models?.[oldKey]) {
        return config;
    }
    const provider = config.models[oldKey];
    const { [oldKey]: _removed, ...restModels } = config.models;
    const defaultModel = config.agents?.default?.model || {};
    return {
        ...config,
        models: {
            ...restModels,
            [newKey]: provider,
        },
        agents: {
            ...config.agents,
            default: {
                ...config.agents.default,
                model: {
                    ...defaultModel,
                    primary: replaceProviderRef(defaultModel.primary, oldKey, newKey),
                    fallbacks: (defaultModel.fallbacks || []).map((ref) =>
                        replaceProviderRef(ref, oldKey, newKey),
                    ),
                },
            },
        },
    };
}

export function mergeSyncedProviderIntoConfig(config, providerKey, syncedProvider) {
    if (!providerKey || !syncedProvider) {
        return config;
    }
    return {
        ...config,
        models: {
            ...config.models,
            [providerKey]: syncedProvider,
        },
    };
}
