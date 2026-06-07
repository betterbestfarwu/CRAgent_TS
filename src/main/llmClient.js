import { randomUUID } from "node:crypto";
import { isContextOverflowError, isRetryableLlmError } from "./modelFallback.js";
import {
    extractInlineImagePayloads,
    stripInlineImagePayloads,
} from "@shared/imagePayloads.js";
import {
    DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS,
    DEFAULT_LLM_TEMPERATURE,
    resolveLlmRequestTimeoutMs,
    resolveLlmTemperature,
} from "@shared/uiConfig.js";

export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS * 1000;

function createLlmHttpError(status, bodyText) {
    const error = new Error(`模型请求失败: ${status} ${bodyText.slice(0, 200)}`);
    error.status = status;
    return error;
}

export function createLlmRequestSignal(externalSignal, timeoutMs = DEFAULT_LLM_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    let timeoutId = null;
    let timedOut = false;

    const abort = (reason) => {
        if (!controller.signal.aborted) {
            controller.abort(reason);
        }
    };

    if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
            timedOut = true;
            abort(
                new Error(`模型请求超时（${Math.round(timeoutMs / 1000)}秒）`),
            );
        }, timeoutMs);
    }

    if (externalSignal) {
        if (externalSignal.aborted) {
            abort(externalSignal.reason);
        } else {
            externalSignal.addEventListener(
                "abort",
                () => abort(externalSignal.reason),
                { once: true },
            );
        }
    }

    return {
        signal: controller.signal,
        didTimeout: () => timedOut,
        cleanup: () => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        },
    };
}

export function buildLlmRequestUrl(provider) {
    const baseUrl = String(provider?.baseUrl || "").replace(/\/+$/, "");
    const api = String(provider?.api || "chat/completions").replace(/^\/+/, "");
    return `${baseUrl}/${api}`;
}

async function fetchLlmResponse(provider, body, { signal, timeoutMs }) {
    const url = buildLlmRequestUrl(provider);
    console.log(`[CRAgent][LLM] request url: ${url}`);
    const { signal: requestSignal, didTimeout, cleanup } = createLlmRequestSignal(
        signal,
        timeoutMs,
    );
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: requestSignal,
        });
        return response;
    } catch (error) {
        if (error?.name === "AbortError" && didTimeout() && !signal?.aborted) {
            throw new Error(`模型请求超时（${Math.round(timeoutMs / 1000)}秒）`);
        }
        throw error;
    } finally {
        cleanup();
    }
}

export function messagesToApiPayloads(messages) {
    const payloads = [];
    for (const message of messages) {
        payloads.push(messageToApiPayload(message));
        const imageAttachments = (message.images || []).filter((image) => image?.dataUrl);
        if ((message.role === "tool" || message.role === "assistant") && imageAttachments.length) {
            const parts = [
                {
                    type: "text",
                    text:
                        message.role === "tool"
                            ? `[Visual output from tool ${message.name || "tool"}]`
                            : "[Visual output from assistant]",
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

function normalizeDataUrlImage(url, mimeType = "image/png") {
    if (typeof url !== "string") {
        return null;
    }
    const trimmed = url.trim();
    if (!trimmed) {
        return null;
    }
    if (trimmed.startsWith("data:image/")) {
        const match = /^data:([^;]+);/i.exec(trimmed);
        return {
            mimeType: match?.[1] || mimeType,
            dataUrl: trimmed,
        };
    }
    return null;
}

function imageFromBlock(block) {
    if (!block || typeof block !== "object") {
        return null;
    }

    const directUrl = normalizeDataUrlImage(
        block.image_url?.url || block.url || block.dataUrl,
        block.mimeType || block.mime_type,
    );
    if (directUrl) {
        return directUrl;
    }

    const mimeType =
        block.mimeType ||
        block.mime_type ||
        block.inline_data?.mime_type ||
        block.source?.media_type ||
        "image/png";
    const encoded =
        block.data ||
        block.b64_json ||
        block.image_base64 ||
        block.base64_image ||
        block.inline_data?.data ||
        block.source?.data;
    if (typeof encoded === "string" && encoded.trim()) {
        return {
            mimeType,
            dataUrl: `data:${mimeType};base64,${encoded.replace(/\s/g, "")}`,
        };
    }

    return null;
}

export function parseAssistantContent(content) {
    if (typeof content === "string") {
        const extracted = extractInlineImagePayloads(content);
        return {
            content: extracted.text,
            images: extracted.images.length ? extracted.images : undefined,
        };
    }

    const blocks = Array.isArray(content)
        ? content
        : Array.isArray(content?.parts)
          ? content.parts
          : content
            ? [content]
            : [];
    const parts = [];
    const images = [];

    for (const block of blocks) {
        if (typeof block === "string") {
            const extracted = extractInlineImagePayloads(block);
            if (extracted.text) {
                parts.push(extracted.text);
            }
            if (extracted.images.length) {
                images.push(...extracted.images);
            }
            continue;
        }
        if (!block || typeof block !== "object") {
            continue;
        }
        const text = block.text ?? block.content ?? block.output_text;
        if (typeof text === "string" && text.trim()) {
            const extracted = extractInlineImagePayloads(text);
            if (extracted.text) {
                parts.push(extracted.text);
            }
            if (extracted.images.length) {
                images.push(...extracted.images);
            }
        }
        const image = imageFromBlock(block);
        if (image) {
            images.push(image);
        }
    }

    return {
        content: parts.join("\n").trim(),
        images: images.length ? images : undefined,
    };
}

export function parseAssistantChoice(choice) {
    if (!choice || typeof choice !== "object") {
        return {
            content: "",
            reasoningContent: undefined,
            images: undefined,
            useReasoningAsContent: false,
        };
    }

    const contentParsed = parseAssistantContent(choice.content);
    const reasoningParsed = parseAssistantContent(
        choice.reasoning_content ?? choice.reasoningContent,
    );
    const content = contentParsed.content;
    const reasoningContent = reasoningParsed.content || undefined;
    const hasToolCalls = Boolean(choice.tool_calls?.length);
    const images = contentParsed.images?.length
        ? contentParsed.images
        : reasoningParsed.images;

    return {
        content,
        reasoningContent,
        images,
        useReasoningAsContent: !content && Boolean(reasoningContent) && !hasToolCalls,
    };
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
        this.resolveRequestTimeoutMs = options.resolveRequestTimeoutMs;
        this.resolveTemperature = options.resolveTemperature;
        this.requestTimeoutMs =
            options.requestTimeoutMs ?? DEFAULT_LLM_REQUEST_TIMEOUT_MS;
        this.temperature = options.temperature ?? DEFAULT_LLM_TEMPERATURE;
    }

    getRequestTimeoutMs() {
        const resolved = this.resolveRequestTimeoutMs?.();
        if (Number.isFinite(resolved) && resolved > 0) {
            return resolved;
        }
        return this.requestTimeoutMs;
    }

    getTemperature() {
        const resolved = this.resolveTemperature?.();
        if (Number.isFinite(resolved)) {
            return resolved;
        }
        return this.temperature;
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
            temperature: this.getTemperature(),
        };

        const url = buildLlmRequestUrl(provider);
        logOutgoingMessages("complete", model, body.messages, { url });

        const response = await fetchLlmResponse(provider, body, {
            signal,
            timeoutMs: this.getRequestTimeoutMs(),
        });

        if (!response.ok) {
            const text = await response.text();
            throw createLlmHttpError(response.status, text);
        }

        const data = await response.json();
        const choice = data.choices?.[0]?.message;
        const parsed = parseAssistantChoice(choice);
        const usage = extractTokenUsage(data);
        this.reportTokenUsage(model, usage);
        return {
            message: this.assistantMessage(
                parsed.useReasoningAsContent ? parsed.reasoningContent : parsed.content,
                undefined,
                model.modelId,
                parsed.images,
                parsed.useReasoningAsContent ? undefined : parsed.reasoningContent,
            ),
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
            temperature: this.getTemperature(),
        };
        if (tools.length) {
            body.tools = tools;
            body.tool_choice = "auto";
        }

        const url = buildLlmRequestUrl(provider);
        logOutgoingMessages("chat", model, body.messages, {
            url,
            toolCount: tools.length,
        });

        const response = await fetchLlmResponse(provider, body, {
            signal,
            timeoutMs: this.getRequestTimeoutMs(),
        });

        if (!response.ok) {
            const text = await response.text();
            throw createLlmHttpError(response.status, text);
        }

        const data = await response.json();
        const choice = data.choices?.[0]?.message;
        const parsed = parseAssistantChoice(choice);
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
            message: this.assistantMessage(
                parsed.useReasoningAsContent ? parsed.reasoningContent : parsed.content,
                toolCalls,
                model.modelId,
                parsed.images,
                parsed.useReasoningAsContent ? undefined : parsed.reasoningContent,
            ),
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

    assistantMessage(content, toolCalls, modelId, images, reasoningContent) {
        return {
            id: randomUUID(),
            role: "assistant",
            content: content || " ",
            createdAt: new Date().toISOString(),
            ...(modelId ? { modelId } : {}),
            ...(toolCalls?.length ? { toolCalls } : {}),
            ...(images?.length ? { images } : {}),
            ...(reasoningContent ? { reasoningContent } : {}),
        };
    }
}
