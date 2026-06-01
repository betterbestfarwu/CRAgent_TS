import { TOKENS_PER_TOOL_SCHEMA } from "./tokenEstimator.js";

export const MCP_SERVER_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function isValidMcpServerId(id) {
    return MCP_SERVER_ID_PATTERN.test(id);
}

export function normalizeMcpConfig(raw) {
    const mcp = raw?.mcp && typeof raw.mcp === "object" ? raw.mcp : {};
    const enabled = mcp.enabled !== false;
    const servers = Array.isArray(mcp.servers) ? mcp.servers : [];
    const normalized = [];

    for (const entry of servers) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const id = String(entry.id || "").trim();
        const command = String(entry.command || "").trim();
        if (!id || !command) {
            continue;
        }
        if (!isValidMcpServerId(id)) {
            continue;
        }
        normalized.push({
            id,
            command,
            args: Array.isArray(entry.args) ? entry.args.map(String) : [],
            env:
                entry.env && typeof entry.env === "object"
                    ? Object.fromEntries(
                          Object.entries(entry.env).map(([key, value]) => [String(key), String(value)]),
                      )
                    : undefined,
            cwd: entry.cwd ? String(entry.cwd) : undefined,
            disabled: entry.disabled === true,
        });
    }

    return { enabled, servers: normalized };
}

export function getEnabledMcpServers(raw) {
    const { enabled, servers } = normalizeMcpConfig(raw);
    if (!enabled) {
        return [];
    }
    return servers.filter((server) => !server.disabled);
}

export function isMcpConfigured(raw) {
    return getEnabledMcpServers(raw).length > 0;
}

export function mcpToolRegistryName(serverId, toolName) {
    const safeTool = String(toolName).replace(/[^a-zA-Z0-9_-]/g, "_");
    return `mcp__${serverId}__${safeTool}`;
}

export function parseMcpToolRegistryName(registryName) {
    const match = /^mcp__([a-zA-Z][a-zA-Z0-9_-]*)__(.+)$/.exec(registryName);
    if (!match) {
        return null;
    }
    return { serverId: match[1], toolName: match[2] };
}

export function estimateMcpToolDefinitionTokens(toolCount) {
    const count = Math.max(0, Number(toolCount) || 0);
    return count * TOKENS_PER_TOOL_SCHEMA;
}

export function createEmptyMcpServer(id = "mcp-server") {
    return {
        id,
        command: "",
        args: [],
        env: {},
        cwd: "",
        disabled: false,
    };
}

export function ensureMcpConfigShape(config) {
    const mcp = config?.mcp && typeof config.mcp === "object" ? config.mcp : {};
    return {
        ...config,
        mcp: {
            enabled: mcp.enabled !== false,
            servers: Array.isArray(mcp.servers) ? mcp.servers.map((server) => ({ ...server })) : [],
        },
    };
}

export function formatMcpArgsForEditor(args) {
    return (args || []).join("\n");
}

export function parseMcpArgsFromEditor(text) {
    return String(text || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

export function formatMcpEnvForEditor(env) {
    if (!env || typeof env !== "object") {
        return "";
    }
    return Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
}

export function parseMcpEnvFromEditor(text) {
    const env = {};
    for (const line of String(text || "").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        const index = trimmed.indexOf("=");
        if (index <= 0) {
            continue;
        }
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1);
        if (key) {
            env[key] = value;
        }
    }
    return Object.keys(env).length ? env : undefined;
}

export function validateMcpServerDraft(server) {
    const id = String(server?.id || "").trim();
    const command = String(server?.command || "").trim();
    if (!id) {
        return "Server ID 不能为空";
    }
    if (!isValidMcpServerId(id)) {
        return "Server ID 须以字母开头，仅含字母、数字、_、-";
    }
    if (!command) {
        return "启动命令不能为空";
    }
    return null;
}

export function suggestNextMcpServerId(servers) {
    const used = new Set((servers || []).map((server) => String(server?.id || "").trim()));
    if (!used.has("mcp-server")) {
        return "mcp-server";
    }
    let index = 2;
    while (used.has(`mcp-server-${index}`)) {
        index += 1;
    }
    return `mcp-server-${index}`;
}
