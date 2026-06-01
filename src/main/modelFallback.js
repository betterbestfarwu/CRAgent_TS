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

const CONTEXT_OVERFLOW_PATTERNS = [
    /\b413\b/,
    /request too large/i,
    /payload too large/i,
    /context.*(length|window|limit)/i,
    /maximum.*tokens/i,
    /token limit/i,
    /too many tokens/i,
];

export function isContextOverflowError(error) {
    if (!error) {
        return false;
    }
    if (error.status === 413) {
        return true;
    }
    const message = String(error.message || error);
    return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message));
}

export function isRetryableLlmError(error) {
    if (!error) {
        return false;
    }
    if (isContextOverflowError(error)) {
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
