export function formatMcpCallToolResult(result) {
    if (!result || typeof result !== "object") {
        return "(empty MCP result)";
    }

    const parts = [];
    for (const block of result.content || []) {
        if (block?.type === "text") {
            parts.push(String(block.text ?? ""));
        } else if (block) {
            parts.push(JSON.stringify(block));
        }
    }
    if (result.structuredContent) {
        parts.push(JSON.stringify(result.structuredContent, null, 2));
    }

    const body = parts.filter(Boolean).join("\n") || "(empty MCP result)";
    if (result.isError) {
        return `Error: ${body}`;
    }
    return body;
}
