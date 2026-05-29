export function parseModelRef(ref) {
    const [providerKey, modelId] = String(ref || "").split("/");
    if (!providerKey || !modelId) {
        return null;
    }
    return { providerKey, modelId };
}

export function buildModelChain(primary, fallbackRefs = []) {
    const chain = [];
    const seen = new Set();

    const add = (model) => {
        if (!model?.providerKey || !model?.modelId) {
            return;
        }
        const key = `${model.providerKey}/${model.modelId}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        chain.push({ providerKey: model.providerKey, modelId: model.modelId });
    };

    add(primary);
    for (const ref of fallbackRefs) {
        add(parseModelRef(ref));
    }
    return chain;
}

export function isRetryableLlmError(error) {
    if (!error) {
        return false;
    }
    const message = String(error.message || error);
    if (message.includes("API Key")) {
        return false;
    }
    if (message.includes("slash 指令")) {
        return false;
    }
    return true;
}
