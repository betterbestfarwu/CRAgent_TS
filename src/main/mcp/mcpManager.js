import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getEnabledMcpServers } from "@shared/mcpConfig.js";
import { formatMcpCallToolResult } from "./formatMcpResult.js";

export class McpManager {
    constructor(getConfig) {
        this.getConfig = getConfig;
        this.sessions = new Map();
        this.toolCache = new Map();
        this.errors = new Map();
        this.registryEntries = [];
        this.refreshPromise = null;
    }

    getServerErrors() {
        return Object.fromEntries(this.errors);
    }

    getToolCount() {
        return this.registryEntries.length;
    }

    getRegistryEntries() {
        return this.registryEntries;
    }

    async refresh() {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        this.refreshPromise = this.#refreshInternal().finally(() => {
            this.refreshPromise = null;
        });
        return this.refreshPromise;
    }

    async #refreshInternal() {
        const servers = getEnabledMcpServers(this.getConfig());
        const activeIds = new Set(servers.map((server) => server.id));

        for (const serverId of [...this.sessions.keys()]) {
            if (!activeIds.has(serverId)) {
                await this.#disconnect(serverId);
            }
        }

        this.toolCache.clear();
        this.registryEntries = [];
        this.errors.clear();

        for (const server of servers) {
            try {
                const tools = await this.#listServerTools(server.id);
                this.toolCache.set(server.id, tools);
                for (const tool of tools) {
                    this.registryEntries.push({ serverId: server.id, tool });
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.errors.set(server.id, message);
            }
        }

        return this.registryEntries;
    }

    async #listServerTools(serverId) {
        const { client } = await this.#ensureConnected(serverId);
        const tools = [];
        let cursor;
        do {
            const page = await client.listTools(cursor ? { cursor } : undefined);
            tools.push(...(page.tools || []));
            cursor = page.nextCursor;
        } while (cursor);
        return tools;
    }

    async #ensureConnected(serverId) {
        const existing = this.sessions.get(serverId);
        if (existing) {
            return existing;
        }

        const server = getEnabledMcpServers(this.getConfig()).find((entry) => entry.id === serverId);
        if (!server) {
            throw new Error(`MCP server '${serverId}' is not configured`);
        }

        const transport = new StdioClientTransport({
            command: server.command,
            args: server.args,
            env: server.env,
            cwd: server.cwd,
            stderr: "pipe",
        });
        const client = new Client({ name: "cragent", version: "0.1.0" });
        await client.connect(transport);
        const session = { client, transport };
        this.sessions.set(serverId, session);
        return session;
    }

    async callTool(serverId, toolName, args) {
        const { client } = await this.#ensureConnected(serverId);
        const result = await client.callTool({
            name: toolName,
            arguments: args ?? {},
        });
        return formatMcpCallToolResult(result);
    }

    async #disconnect(serverId) {
        const session = this.sessions.get(serverId);
        if (!session) {
            return;
        }
        this.sessions.delete(serverId);
        this.toolCache.delete(serverId);
        try {
            await session.client.close();
        } catch {
            // ignore close errors
        }
        try {
            await session.transport.close();
        } catch {
            // ignore close errors
        }
    }

    async closeAll() {
        for (const serverId of [...this.sessions.keys()]) {
            await this.#disconnect(serverId);
        }
        this.registryEntries = [];
        this.errors.clear();
    }
}
