import { mcpToolRegistryName } from "@shared/mcpConfig.js";

function fnSchema(name, description, parameters) {
    return {
        type: "function",
        function: { name, description, parameters },
    };
}

function mcpInputSchemaToOpenAiParameters(inputSchema) {
    if (inputSchema && typeof inputSchema === "object" && inputSchema.type === "object") {
        return inputSchema;
    }
    return { type: "object", properties: {} };
}

export function createMcpTools({ mcpManager, getAgentTools, getConfig }) {
    return () => {
        const built = [];
        for (const { serverId, tool } of mcpManager.getRegistryEntries()) {
            const registryName = mcpToolRegistryName(serverId, tool.name);
            const description =
                tool.description?.trim() ||
                `MCP tool '${tool.name}' from server '${serverId}'`;
            built.push({
                name: registryName,
                requiresConfirmation: true,
                enabled: () => {
                    const agentTools = getAgentTools();
                    if (agentTools.enable_tools === false) {
                        return false;
                    }
                    if (agentTools.enable_mcp === false) {
                        return false;
                    }
                    const mcp = getConfig()?.mcp;
                    return mcp?.enabled !== false;
                },
                schema: fnSchema(
                    registryName,
                    `[MCP:${serverId}] ${description}`,
                    mcpInputSchemaToOpenAiParameters(tool.inputSchema),
                ),
                async execute(args) {
                    return mcpManager.callTool(serverId, tool.name, args);
                },
            });
        }
        return built;
    };
}
