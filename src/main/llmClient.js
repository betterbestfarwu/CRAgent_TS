import { randomUUID } from "node:crypto";

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

    async complete({ messages, model }) {
        const provider = this.resolveProvider(model.providerKey);
        if (!provider || !provider.apiKey || provider.apiKey.includes("REPLACE_ME")) {
            return {
                message: this.assistantMessage("请先在设置中配置有效 API Key，再继续对话。"),
            };
        }

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
        });

        if (!response.ok) {
            const text = await response.text();
            return {
                message: this.assistantMessage(
                    `模型请求失败: ${response.status} ${text.slice(0, 200)}`,
                ),
            };
        }

        const data = await response.json();
        const choice = data.choices?.[0]?.message;
        return {
            message: this.assistantMessage(choice?.content || ""),
        };
    }

    async chat({ messages, model, tools = [] }) {
        const provider = this.resolveProvider(model.providerKey);
        if (!provider || !provider.apiKey || provider.apiKey.includes("REPLACE_ME")) {
            return {
                message: this.assistantMessage("请先在设置中配置有效 API Key，再继续对话。"),
            };
        }

        const last = messages[messages.length - 1];
        if (last?.role === "user" && last.content.startsWith("/")) {
            return { message: this.assistantMessage("已识别 slash 指令。") };
        }

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
        });

        if (!response.ok) {
            const text = await response.text();
            return {
                message: this.assistantMessage(
                    `模型请求失败: ${response.status} ${text.slice(0, 200)}`,
                ),
            };
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
            message: this.assistantMessage(choice?.content || "", toolCalls),
        };
    }

    assistantMessage(content, toolCalls) {
        return {
            id: randomUUID(),
            role: "assistant",
            content: content || " ",
            createdAt: new Date().toISOString(),
            ...(toolCalls?.length ? { toolCalls } : {}),
        };
    }
}
