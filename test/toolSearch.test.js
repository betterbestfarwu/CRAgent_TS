import test from "node:test";
import assert from "node:assert/strict";
import { mcpToolRegistryName } from "../src/shared/mcpConfig.js";
import { ToolRegistry } from "../src/main/toolRegistry.js";
import {
    PINNED_TOOL_NAMES,
    schemasForToolCatalog,
    searchDeferredTools,
    shouldUseToolSearch,
    TOOL_SEARCH_THRESHOLD,
} from "../src/main/toolSearch.js";

function mockTool(name, description = name) {
    return {
        name,
        enabled: () => true,
        schema: {
            type: "function",
            function: { name, description, parameters: { type: "object", properties: {} } },
        },
        async execute() {
            return `ok:${name}`;
        },
    };
}

function buildCatalog(extraMcpCount) {
    const tools = [...PINNED_TOOL_NAMES]
        .filter((name) => name !== "tool_search")
        .map((name) => mockTool(name));
    for (let index = 0; index < extraMcpCount; index += 1) {
        tools.push(
            mockTool(
                mcpToolRegistryName("srv", `tool_${index}`),
                `MCP capability number ${index} for payments`,
            ),
        );
    }
    return tools;
}

test("shouldUseToolSearch triggers above threshold", () => {
    assert.equal(shouldUseToolSearch(TOOL_SEARCH_THRESHOLD), false);
    assert.equal(shouldUseToolSearch(TOOL_SEARCH_THRESHOLD + 1), true);
});

test("schemasForToolCatalog omits deferred tools until unlocked", () => {
    const tools = buildCatalog(10);
    assert.equal(tools.filter((tool) => tool.enabled()).length, PINNED_TOOL_NAMES.size - 1 + 10);

    const unlocked = new Set();
    const initial = schemasForToolCatalog(tools, { unlockedToolNames: unlocked });
    const initialNames = initial.map((schema) => schema.function.name);

    assert.ok(initialNames.includes("tool_search"));
    assert.ok(initialNames.includes("read_file"));
    assert.ok(!initialNames.some((name) => name.startsWith("mcp__")));
    assert.ok(initial.length < tools.length);

    unlocked.add(mcpToolRegistryName("srv", "tool_3"));
    const afterUnlock = schemasForToolCatalog(tools, { unlockedToolNames: unlocked });
    assert.ok(afterUnlock.some((schema) => schema.function.name === mcpToolRegistryName("srv", "tool_3")));
});

test("searchDeferredTools ranks MCP tools by query", () => {
    const tools = buildCatalog(5);
    const matches = searchDeferredTools(tools, "payments tool_1");
    assert.equal(matches[0]?.name, mcpToolRegistryName("srv", "tool_1"));
});

test("ToolRegistry tool_search unlocks deferred tools for the run", async () => {
    const tools = buildCatalog(10);
    const registry = new ToolRegistry(() => tools, async () => true);
    const unlocked = new Set();

    const before = registry.schemas({ unlockedToolNames: unlocked });
    assert.ok(!before.some((schema) => schema.function.name === mcpToolRegistryName("srv", "tool_2")));

    const searchResult = await registry.execute(
        {
            function: {
                name: "tool_search",
                arguments: JSON.stringify({ query: "tool_2" }),
            },
        },
        { unlockedToolNames: unlocked },
    );
    assert.match(searchResult, /tool_2/);
    assert.ok(unlocked.has(mcpToolRegistryName("srv", "tool_2")));

    const after = registry.schemas({ unlockedToolNames: unlocked });
    assert.ok(after.some((schema) => schema.function.name === mcpToolRegistryName("srv", "tool_2")));

    const output = await registry.execute(
        {
            function: {
                name: mcpToolRegistryName("srv", "tool_2"),
                arguments: "{}",
            },
        },
        { unlockedToolNames: unlocked },
    );
    assert.equal(output, `ok:${mcpToolRegistryName("srv", "tool_2")}`);
});

test("small catalogs pass through all schemas", () => {
    const tools = [mockTool("read_file"), mockTool("bash"), mockTool("TodoWrite")];
    const schemas = schemasForToolCatalog(tools);
    assert.equal(schemas.length, 3);
    assert.ok(!schemas.some((schema) => schema.function.name === "tool_search"));
});
