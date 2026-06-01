import { randomUUID } from "node:crypto";
import { isContextOverflowError, isRetryableLlmError } from "./modelFallback.js";

function createLlmHttpError(status, bodyText) {
    const error = new Error(`模型请求失败: ${status} ${bodyText.slice(0, 200)}`);
    error.status = status;
    return error;
}

function messageToApiPayload(message) {
    const payload = { role: message.role };
    if (message.role === "assistant") {
        payload.content = message.content || "";
        if (message.toolCalls?.length) {
            payload.tool_calls = message.toolCalls.map((call) => ({
                id: call.id,
                type: call.type || "function",
                function: {
                    name: call.function.name,
                    arguments: call.function.arguments,
                },
            }));
        }
        return payload;
    }
    if (message.role === "tool") {
        payload.content = message.content;
        if (message.toolCallId) {
            payload.tool_call_id = message.toolCallId;
        }
        if (message.name) {
            payload.name = message.name;
        }
        return payload;
    }
    if (message.role === "user" && message.images?.length) {
        const parts = [];
        if (message.content) {
            parts.push({ type: "text", text: message.content });
        }
        for (const image of message.images) {
            parts.push({
                type: "image_url",
                image_url: { url: image.dataUrl },
            });
        }
        payload.content = parts;
        return payload;
    }
    payload.content = message.content;
    return payload;
}

function logOutgoingMessages(kind, model, messages, extra = {}) {
    const payload = {
        kind,
        model: `${model.providerKey}/${model.modelId}`,
        messageCount: messages.length,
        messages,
        ...extra,
    };
    console.log("[CRAgent][LLM] outgoing messages\n" + JSON.stringify(payload, null, 2));
}

export class LlmClient {
    constructor(resolveProvider) {
        this.resolveProvider = resolveProvider;
    }

    resolveProviderOrThrow(model) {
        const provider = this.resolveProvider(model.providerKey);
        if (!provider || !provider.apiKey || provider.apiKey.includes("REPLACE_ME")) {
            throw new Error("请先在设置中配置有效 API Key，再继续对话。");
        }
        return provider;
    }

    async completeOnce({ messages, model, signal }) {
        const provider = this.resolveProviderOrThrow(model);
        const body = {
            model: model.modelId,
            messages: messages.map(messageToApiPayload),
        };

        logOutgoingMessages("complete", model, body.messages);

        const response = await fetch(`${provider.baseUrl}/${provider.api}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify(body),
            ...(signal ? { signal } : {}),
        });

        if (!response.ok) {
            const text = await response.text();
            throw createLlmHttpError(response.status, text);
        }

        const data = await response.json();
        const choice = data.choices?.[0]?.message;
        return {
            message: this.assistantMessage(choice?.content || "", undefined, model.modelId),
        };
    }

    async complete({ messages, model, modelChain = [], signal }) {
        const chain = modelChain.length ? modelChain : [model];
        let lastError = null;
        for (const currentModel of chain) {
            try {
                const result = await this.completeOnce({
                    messages,
                    model: currentModel,
                    signal,
                });
                return {
                    ...result,
                    usedModel: currentModel,
                    usedFallback: chain.indexOf(currentModel) > 0,
                };
            } catch (error) {
                if (error?.name === "AbortError") {
                    throw error;
                }
                if (isContextOverflowError(error)) {
                    throw error;
                }
                lastError = error;
                if (!isRetryableLlmError(error)) {
                    return {
                        message: this.assistantMessage(
                            error.message,
                            undefined,
                            currentModel.modelId,
                        ),
                    };
                }
                console.warn(
                    `[CRAgent][LLM] complete failed for ${currentModel.providerKey}/${currentModel.modelId}: ${error.message}`,
                );
            }
        }
        const lastModel = chain[chain.length - 1];
        return {
            message: this.assistantMessage(
                `所有模型均请求失败。最后错误: ${lastError?.message || "unknown"}`,
                undefined,
                lastModel?.modelId,
            ),
        };
    }

    async chatOnce({ messages, model, tools = [], signal }) {
        const provider = this.resolveProviderOrThrow(model);

        const body = {
            model: model.modelId,
            messages: messages.map(messageToApiPayload),
        };
        if (tools.length) {
            body.tools = tools;
            body.tool_choice = "auto";
        }

        logOutgoingMessages("chat", model, body.messages, {
            toolCount: tools.length,
        });

        const response = await fetch(`${provider.baseUrl}/${provider.api}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify(body),
            ...(signal ? { signal } : {}),
        });

        if (!response.ok) {
            const text = await response.text();
            throw createLlmHttpError(response.status, text);
        }

        const data = await response.json();
        const choice = data.choices?.[0]?.message;
        const toolCalls = choice?.tool_calls?.map((call) => ({
            id: call.id,
            type: call.type || "function",
            function: {
                name: call.function?.name || "",
                arguments: call.function?.arguments || "{}",
            },
        }));

        return {
            message: this.assistantMessage(choice?.content || "", toolCalls, model.modelId),
        };
    }

    async chat({ messages, model, modelChain = [], tools = [], signal }) {
        const chain = modelChain.length ? modelChain : [model];
        let lastError = null;
        for (const currentModel of chain) {
            try {
                const result = await this.chatOnce({ messages, model: currentModel, tools, signal });
                return {
                    ...result,
                    usedModel: currentModel,
                    usedFallback: chain.indexOf(currentModel) > 0,
                };
            } catch (error) {
                if (error?.name === "AbortError") {
                    throw error;
                }
                if (isContextOverflowError(error)) {
                    throw error;
                }
                lastError = error;
                if (!isRetryableLlmError(error)) {
                    return {
                        message: this.assistantMessage(
                            error.message,
                            undefined,
                            currentModel.modelId,
                        ),
                    };
                }
                console.warn(
                    `[CRAgent][LLM] chat failed for ${currentModel.providerKey}/${currentModel.modelId}: ${error.message}`,
                );
            }
        }
        const lastModel = chain[chain.length - 1];
        if (isContextOverflowError(lastError)) {
            throw lastError;
        }
        return {
            message: this.assistantMessage(
                `所有模型均请求失败。最后错误: ${lastError?.message || "unknown"}`,
                undefined,
                lastModel?.modelId,
            ),
        };
    }

    assistantMessage(content, toolCalls, modelId) {
        return {
            id: randomUUID(),
            role: "assistant",
            content: content || " ",
            createdAt: new Date().toISOString(),
            ...(modelId ? { modelId } : {}),
            ...(toolCalls?.length ? { toolCalls } : {}),
        };
    }
}
