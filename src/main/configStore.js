import fs from "node:fs";
import { DEFAULT_CONTEXT_CONFIG } from "@shared/contextConfig";
import { DEFAULT_UI_CONFIG } from "@shared/uiConfig.js";
import { parseModelRef } from "@shared/modelRef.js";
import { resolvePrimaryModelRef } from "@shared/modelsConfig.js";
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
        return (
            parseModelRef(resolvePrimaryModelRef(this.data.models, this.data.agents.default.model.primary)) ||
            {
                providerKey: "",
                modelId: "",
            }
        );
    }
    resolveModelChain(providerKey, modelId) {
        const primary = { providerKey, modelId };
        const fallbacks = this.data.agents?.default?.model?.fallbacks || [];
        const chain = [primary];
        const seen = new Set([`${providerKey}/${modelId}`]);
        for (const ref of fallbacks) {
            const next = parseModelRef(ref);
            if (!next) {
                continue;
            }
            const key = `${next.providerKey}/${next.modelId}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            chain.push(next);
        }
        return chain;
    }
    model(providerKey, modelId) {
        return this.data.models[providerKey]?.models.find((m) => m.id === modelId);
    }
    recordModelTokenUsage(providerKey, modelId, usage) {
        if (!usage || !providerKey || !modelId) {
            return this.data;
        }
        const promptTokens = Number(usage.prompt_tokens) || 0;
        const completionTokens = Number(usage.completion_tokens) || 0;
        const totalTokens = Number(usage.total_tokens) || promptTokens + completionTokens;
        if (!promptTokens && !completionTokens && !totalTokens) {
            return this.data;
        }

        const provider = this.data.models?.[providerKey];
        if (!provider?.models?.length) {
            return this.data;
        }

        const models = provider.models.map((entry) => {
            if (entry.id !== modelId) {
                return entry;
            }
            const previous = entry.cost || {};
            return {
                ...entry,
                cost: {
                    prompt_tokens: (previous.prompt_tokens || 0) + promptTokens,
                    completion_tokens: (previous.completion_tokens || 0) + completionTokens,
                    total_tokens: (previous.total_tokens || 0) + totalTokens,
                },
            };
        });

        this.data = {
            ...this.data,
            models: {
                ...this.data.models,
                [providerKey]: {
                    ...provider,
                    models,
                },
            },
        };
        this.persist();
        return this.data;
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
            context: { ...DEFAULT_CONTEXT_CONFIG },
            ui: { ...DEFAULT_UI_CONFIG },
            models: {
                openai: {
                    baseUrl: "https://api.openai.com/v1",
                    apiKey: "sk-REPLACE_ME",
                    api: "chat/completions",
                    state: true,
                    models,
                },
            },
            mcp: {
                enabled: true,
                servers: [],
            },
            agents: {
                default: {
                    model: { primary: "openai/gpt-4o-mini", fallbacks: [] },
                    workspace: "~/.CRAgent",
                    execution_mode: "goal",
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
                            enable_mcp: true,
                            enable_computer_use: false,
                            enable_web_search: false,
                            allow_sub_agents: false,
                        },
                    },
                ],
            },
        };
    }
}
