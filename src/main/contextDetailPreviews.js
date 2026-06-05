import fs from "node:fs";
import path from "node:path";
import { isContextDividerMessage } from "@shared/chatMessages.js";
import { getEnabledMcpServers, parseMcpToolRegistryName } from "@shared/mcpConfig.js";
import { stripInlineImagePayloads } from "@shared/imagePayloads.js";
import { SUB_AGENT_TYPES, subAgentSystemPrompt } from "./subAgentTypes.js";
import { formatTodosForPrompt } from "./todoState.js";
import { isDeferredTool } from "./toolSearch.js";

const MAX_MESSAGE_PREVIEW_CHARS = 12_000;
const MAX_CONVERSATION_PREVIEW_CHARS = 100_000;

function truncateText(text, maxChars) {
    const value = stripInlineImagePayloads(text);
    if (value.length <= maxChars) {
        return value;
    }
    return `${value.slice(0, maxChars)}\n… [truncated ${value.length - maxChars} chars]`;
}

function formatToolSchemaPreview(schema) {
    const fn = schema?.function;
    if (!fn) {
        return "";
    }
    const params = fn.parameters ? JSON.stringify(fn.parameters, null, 2) : "{}";
    return `${fn.name}\n${fn.description || "(no description)"}\n${params}`;
}

export function buildToolDefinitionsPreview(toolRegistry, agentTools) {
    if (agentTools.enable_tools === false) {
        return "(tools disabled)";
    }
    const schemas = toolRegistry.schemas();
    if (!schemas.length) {
        return "(no tool schemas in initial catalog)";
    }
    return schemas.map(formatToolSchemaPreview).join("\n\n---\n\n");
}

export function buildRulesPreview(session, workspaceRoot) {
    const parts = [];
    const agentsPath = path.join(workspaceRoot, "AGENTS.md");
    if (fs.existsSync(agentsPath)) {
        parts.push(fs.readFileSync(agentsPath, "utf-8").trim());
    } else {
        parts.push("(AGENTS.md not found in workspace)");
    }
    const todos = formatTodosForPrompt(session.meta.todos);
    if (todos) {
        parts.push(todos);
    }
    return parts.join("\n\n");
}

export function buildSkillsPreview(skillLoader, agentTools) {
    if (agentTools.enable_skills === false) {
        return "(skills disabled)";
    }
    const section = skillLoader.systemPromptSection();
    return section?.trim() || "(no skills catalog)";
}

export function buildMcpPreview(config, toolRegistry, agentTools) {
    if (agentTools.enable_mcp === false) {
        return "(MCP disabled)";
    }
    const servers = getEnabledMcpServers(config);
    if (!servers.length) {
        return "(no MCP servers configured)";
    }
    const parts = ["Configured servers:"];
    for (const server of servers) {
        const args = (server.args || []).join(" ");
        parts.push(`- ${server.id}: ${server.command}${args ? ` ${args}` : ""}`);
    }
    const mcpTools = toolRegistry.activeTools().filter((tool) => isDeferredTool(tool.name));
    if (mcpTools.length) {
        parts.push("", "Deferred MCP tools (enabled via tool_search):");
        for (const tool of mcpTools) {
            const parsed = parseMcpToolRegistryName(tool.name);
            const desc = tool.schema?.function?.description || "";
            parts.push(
                `- ${parsed?.serverId || "?"} / ${parsed?.toolName || tool.name}: ${desc}`,
            );
        }
    } else {
        parts.push("", "(MCP tools not loaded yet — check MCP settings or wait for refresh)");
    }
    return parts.join("\n");
}

export function buildSubagentDefinitionsPreview(agentTools) {
    if (!agentTools.allow_sub_agents) {
        return "(sub-agents disabled)";
    }
    return Object.keys(SUB_AGENT_TYPES)
        .map((type) => subAgentSystemPrompt(type))
        .join("\n\n---\n\n");
}

function formatMessagePreview(message) {
    const role = message.role || "unknown";
    const name = message.name ? ` (${message.name})` : "";
    let body = stripInlineImagePayloads(message.content);
    if (message.toolCalls?.length) {
        const calls = message.toolCalls
            .map((call) => `${call.function?.name}(${call.function?.arguments || ""})`)
            .join("\n");
        body = body ? `${body}\n[tool_calls]\n${calls}` : `[tool_calls]\n${calls}`;
    }
    if (message.images?.length) {
        body = `${body}\n[${message.images.length} image(s) attached]`.trim();
    }
    return `[${role}${name}]\n${truncateText(body, MAX_MESSAGE_PREVIEW_CHARS)}`;
}

export function buildConversationPreview(session) {
    const parts = [];
    const fromIndex = Math.max(0, session.meta.llmContextFromIndex ?? 0);

    if (session.meta.contextSummary) {
        parts.push(
            `[conversation_summary]\n${truncateText(session.meta.contextSummary, MAX_MESSAGE_PREVIEW_CHARS)}`,
        );
    }
    if (session.meta.postCompactContext) {
        parts.push(
            `[post_compact_context]\n${truncateText(session.meta.postCompactContext, MAX_MESSAGE_PREVIEW_CHARS)}`,
        );
    }
    if (session.meta.sessionMemory) {
        parts.push(
            `[session_memory]\n${truncateText(session.meta.sessionMemory, MAX_MESSAGE_PREVIEW_CHARS)}`,
        );
    }

    const active = session.messages
        .slice(fromIndex)
        .filter((message) => !isContextDividerMessage(message));

    if (!active.length && !parts.length) {
        return "(empty conversation in LLM context)";
    }

    for (const message of active) {
        parts.push(formatMessagePreview(message));
    }

    return truncateText(parts.join("\n\n"), MAX_CONVERSATION_PREVIEW_CHARS);
}

export function buildContextCategoryPreviews({
    session,
    config,
    agentTools,
    toolRegistry,
    skillLoader,
    workspaceRoot,
    systemPromptText,
}) {
    return {
        systemPrompt: systemPromptText,
        toolDefinitions: buildToolDefinitionsPreview(toolRegistry, agentTools),
        rules: buildRulesPreview(session, workspaceRoot),
        skills: buildSkillsPreview(skillLoader, agentTools),
        mcp: buildMcpPreview(config, toolRegistry, agentTools),
        subagentDefinitions: buildSubagentDefinitionsPreview(agentTools),
        conversation: buildConversationPreview(session),
    };
}

export function attachContextCategoryPreviews(options) {
    const previews = buildContextCategoryPreviews(options);
    return options.categories.map((category) => ({
        ...category,
        previewText:
            previews[category.id]?.trim() ||
            category.previewText?.trim() ||
            "(无内容)",
    }));
}
