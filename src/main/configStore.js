import fs from "node:fs";
export class ConfigStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = this.load();
    }
    get() {
        return this.data;
    }
    update(next) {
        this.data = next;
        this.persist();
        return this.data;
    }
    updateProvider(providerKey, provider) {
        this.data = {
            ...this.data,
            models: {
                ...this.data.models,
                [providerKey]: provider,
            },
        };
        this.persist();
        return this.data;
    }
    resolvePrimaryRef() {
        const [providerKey, modelId] = this.data.agents.default.model.primary.split("/");
        return { providerKey, modelId };
    }
    resolveModelChain(providerKey, modelId) {
        const primary = { providerKey, modelId };
        const fallbacks = this.data.agents?.default?.model?.fallbacks || [];
        const chain = [primary];
        const seen = new Set([`${providerKey}/${modelId}`]);
        for (const ref of fallbacks) {
            const [nextProvider, nextModel] = String(ref || "").split("/");
            if (!nextProvider || !nextModel) {
                continue;
            }
            const key = `${nextProvider}/${nextModel}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            chain.push({ providerKey: nextProvider, modelId: nextModel });
        }
        return chain;
    }
    model(providerKey, modelId) {
        return this.data.models[providerKey]?.models.find((m) => m.id === modelId);
    }
    load() {
        if (fs.existsSync(this.filePath)) {
            return JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
        }
        const initial = this.bootstrapDefault();
        this.data = initial;
        this.persist();
        return initial;
    }
    persist() {
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    }
    bootstrapDefault() {
        const models = ["gpt-4o-mini", "gpt-5", "claude-opus-4-5", "gemini-2.5-pro"].map((id) => ({
            id,
            name: id,
            description: "",
            reasoning: false,
            input: ["text"],
            cost: {},
            contextWindow: 128000,
            maxTokens: 8192,
            state: true,
            stream: false,
        }));
        return {
            content_limit: 5000,
            models: {
                openai: {
                    baseUrl: "https://api.openai.com/v1",
                    apiKey: "sk-REPLACE_ME",
                    api: "chat/completions",
                    state: true,
                    models,
                },
            },
            agents: {
                default: {
                    model: { primary: "openai/gpt-4o-mini", fallbacks: [] },
                    workspace: "~/.CRAgent",
                },
                list: [
                    {
                        id: "main",
                        name: "main",
                        is_default: true,
                        max_tool_rounds: 12,
                        tools: {
                            enable_tools: true,
                            enable_file_tools: true,
                            enable_skills: true,
                            allow_sub_agents: false,
                        },
                    },
                ],
            },
        };
    }
}
