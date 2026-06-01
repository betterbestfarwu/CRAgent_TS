import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    estimateMcpToolDefinitionTokens,
    formatMcpArgsForEditor,
    getEnabledMcpServers,
    isMcpConfigured,
    mcpToolRegistryName,
    normalizeMcpConfig,
    parseMcpArgsFromEditor,
    parseMcpEnvFromEditor,
    parseMcpToolRegistryName,
    suggestNextMcpServerId,
} from "../src/shared/mcpConfig.js";
import { McpManager } from "../src/main/mcp/mcpManager.js";
import { createMcpTools } from "../src/main/mcp/mcpTools.js";
import { ToolRegistry } from "../src/main/toolRegistry.js";
import { formatMcpCallToolResult } from "../src/main/mcp/formatMcpResult.js";

const fixtureServer = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures/mcp-echo-server.mjs",
);

test("normalizeMcpConfig filters invalid servers", () => {
    const config = normalizeMcpConfig({
        mcp: {
            enabled: true,
            servers: [
                { id: "echo", command: "node", args: ["server.mjs"] },
                { id: "bad id", command: "node" },
                { command: "node" },
                { id: "off", command: "node", disabled: true },
            ],
        },
    });

    assert.equal(config.enabled, true);
    assert.equal(config.servers.length, 2);
    assert.equal(config.servers[0].id, "echo");
    assert.equal(config.servers[1].disabled, true);
});

test("mcp tool registry names round-trip", () => {
    const name = mcpToolRegistryName("echo", "my.tool");
    assert.equal(name, "mcp__echo__my_tool");
    assert.deepEqual(parseMcpToolRegistryName(name), {
        serverId: "echo",
        toolName: "my_tool",
    });
});

test("isMcpConfigured reflects enabled servers", () => {
    assert.equal(
        isMcpConfigured({
            mcp: { enabled: true, servers: [{ id: "echo", command: "node", args: [] }] },
        }),
        true,
    );
    assert.equal(
        isMcpConfigured({
            mcp: { enabled: false, servers: [{ id: "echo", command: "node", args: [] }] },
        }),
        false,
    );
});

test("estimateMcpToolDefinitionTokens scales with tool count", () => {
    assert.equal(estimateMcpToolDefinitionTokens(2), 1240);
});

test("McpManager connects to stdio fixture and lists tools", async () => {
    const config = {
        mcp: {
            enabled: true,
            servers: [{ id: "echo", command: process.execPath, args: [fixtureServer] }],
        },
    };
    const manager = new McpManager(() => config);
    const entries = await manager.refresh();
    assert.ok(entries.some((entry) => entry.tool.name === "echo"));
    assert.equal(manager.getToolCount(), 1);

    const result = await manager.callTool("echo", "echo", { message: "hello-mcp" });
    assert.equal(result, "hello-mcp");

    await manager.closeAll();
});

test("ToolRegistry executes MCP tools with mcp__ prefix", async () => {
    const config = {
        mcp: {
            enabled: true,
            servers: [{ id: "echo", command: process.execPath, args: [fixtureServer] }],
        },
    };
    const manager = new McpManager(() => config);
    await manager.refresh();

    const buildMcpTools = createMcpTools({
        mcpManager: manager,
        getAgentTools: () => ({ enable_tools: true, enable_mcp: true }),
        getConfig: () => config,
    });
    const registry = new ToolRegistry(() => buildMcpTools(), async () => true);
    const toolName = mcpToolRegistryName("echo", "echo");
    const schemas = registry.schemas();
    assert.ok(schemas.some((schema) => schema.function.name === toolName));

    const output = await registry.execute({
        function: { name: toolName, arguments: JSON.stringify({ message: "via-registry" }) },
    });
    assert.equal(output, "via-registry");

    await manager.closeAll();
});

test("formatMcpCallToolResult marks errors", () => {
    const text = formatMcpCallToolResult({
        isError: true,
        content: [{ type: "text", text: "boom" }],
    });
    assert.match(text, /^Error: boom/);
});

test("parseMcpArgsFromEditor splits lines", () => {
    assert.deepEqual(parseMcpArgsFromEditor("node\n/path/a.mjs\n"), ["node", "/path/a.mjs"]);
    assert.equal(formatMcpArgsForEditor(["a", "b"]), "a\nb");
});

test("parseMcpEnvFromEditor parses KEY=VALUE", () => {
    assert.deepEqual(parseMcpEnvFromEditor("FOO=bar\n# comment\nBAZ=qux"), {
        FOO: "bar",
        BAZ: "qux",
    });
});

test("suggestNextMcpServerId avoids collisions", () => {
    assert.equal(suggestNextMcpServerId([{ id: "mcp-server" }]), "mcp-server-2");
});

test("getEnabledMcpServers skips disabled entries", () => {
    const servers = getEnabledMcpServers({
        mcp: {
            enabled: true,
            servers: [
                { id: "a", command: "node", args: [] },
                { id: "b", command: "node", args: [], disabled: true },
            ],
        },
    });
    assert.deepEqual(servers.map((server) => server.id), ["a"]);
});
