import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const server = new McpServer({
    name: "cragent-echo-fixture",
    version: "1.0.0",
});

server.registerTool(
    "echo",
    {
        description: "Echo a message back to the client",
        inputSchema: {
            message: z.string().describe("Text to echo"),
        },
    },
    async ({ message }) => ({
        content: [{ type: "text", text: String(message) }],
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
