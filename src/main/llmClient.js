import { randomUUID } from "node:crypto";
import { isContextOverflowError, isRetryableLlmError } from "./modelFallback.js";
import { stripInlineImagePayloads } from "@shared/imagePayloads.js";

function createLlmHttpError(status, bodyText) {
    const error = new Error(`模型请求失败: ${status} ${bodyText.slice(0, 200)}`);
    error.status = status;
    return error;
}

export function messagesToApiPayloads(messages) {
    const payloads = [];
    for (const message of messages) {
        payloads.push(messageToApiPayload(message));
        const imageAttachments = (message.images || []).filter((image) => image?.dataUrl);
        if (message.role === "tool" && imageAttachments.length) {
            const parts = [
                {
                    type: "text",
                    text: `[Visual output from tool ${message.name || "tool"}]`,
                },
            ];
            for (const image of imageAttachments) {
                parts.push({
                    type: "image_url",
                    image_url: { url: image.dataUrl },
                });
            }
            payloads.push({ role: "user", content: parts });
        }
    }
    return payloads;
}

function messageToApiPayload(message) {
    const payload = { role: message.role };
    if (message.role === "assistant") {
        payload.content = stripInlineImagePayloads(message.content);
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
        payload.content = stripInlineImagePayloads(message.content);
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
            parts.push({ type: "text", text: stripInlineImagePayloads(message.content) });
        }
        for (const image of message.images.filter((item) => item?.dataUrl)) {
            parts.push({
                type: "image_url",
                image_url: { url: image.dataUrl },
            });
        }
        payload.content = parts.length ? parts : "";
        return payload;
    }
    payload.content = stripInlineImagePayloads(message.content);
    return payload;
}

function sanitizeForLog(value) {
    if (typeof value === "string") {
        return stripInlineImagePayloads(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeForLog(item));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, sanitizeForLog(item)]),
        );
    }
    return value;
}

function logOutgoingMessages(kind, model, messages, extra = {}) {
    const payload = {
        kind,
        model: `${model.providerKey}/${model.modelId}`,
        messageCount: messages.length,
        messages: sanitizeForLog(messages),
        ...extra,
    };
    console.log("[CRAgent][LLM] outgoing messages\n" + JSON.stringify(payload, null, 2));
}

function extractTokenUsage(data) {
    const usage = data?.usage;
    if (!usage || typeof usage !== "object") {
        return null;
    }
    const promptTokens = Number(usage.prompt_tokens);
    const completionTokens = Number(usage.completion_tokens);
    const totalTokens = Number(usage.total_tokens);
    if (
        !Number.isFinite(promptTokens) &&
        !Number.isFinite(completionTokens) &&
        !Number.isFinite(totalTokens)
    ) {
        return null;
    }
    return {
        prompt_tokens: Number.isFinite(promptTokens) ? promptTokens : 0,
        completion_tokens: Number.isFinite(completionTokens) ? completionTokens : 0,
        total_tokens: Number.isFinite(totalTokens)
            ? totalTokens
            : (Number.isFinite(promptTokens) ? promptTokens : 0) +
              (Number.isFinite(completionTokens) ? completionTokens : 0),
    };
}

export class LlmClient {
    constructor(resolveProvider, options = {}) {
        this.resolveProvider = resolveProvider;
        this.onTokenUsage = options.onTokenUsage;
    }

    reportTokenUsage(model, usage) {
        if (!usage) {
            return;
        }
        this.onTokenUsage?.(model, usage);
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
            messages: messagesToApiPayloads(messages),
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
        const usage = extractTokenUsage(data);
        this.reportTokenUsage(model, usage);
        return {
            message: this.assistantMessage(choice?.content || "", undefined, model.modelId),
            usage,
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
            messages: messagesToApiPayloads(messages),
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
        const usage = extractTokenUsage(data);
        this.reportTokenUsage(model, usage);

        return {
            message: this.assistantMessage(choice?.content || "", toolCalls, model.modelId),
            usage,
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
