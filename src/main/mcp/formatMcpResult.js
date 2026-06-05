import { stripInlineImagePayloads } from "@shared/imagePayloads.js";

export function formatMcpCallToolResult(result) {
    if (!result || typeof result !== "object") {
        return "(empty MCP result)";
    }

    const parts = [];
    const images = [];
    for (const block of result.content || []) {
        if (block?.type === "text") {
            parts.push(stripInlineImagePayloads(block.text));
        } else if (block?.type === "image" && block.data) {
            const mimeType = block.mimeType || block.mime_type || "image/png";
            const data = String(block.data || "");
            images.push({
                mimeType,
                dataUrl: data.startsWith("data:") ? data : `data:${mimeType};base64,${data}`,
            });
            parts.push(`[MCP image output: ${mimeType}]`);
        } else if (block) {
            parts.push(stripInlineImagePayloads(JSON.stringify(block)));
        }
    }
    if (result.structuredContent) {
        parts.push(stripInlineImagePayloads(JSON.stringify(result.structuredContent, null, 2)));
    }

    const body = stripInlineImagePayloads(parts.filter(Boolean).join("\n")) || "(empty MCP result)";
    if (result.isError) {
        return `Error: ${body}`;
    }
    if (images.length) {
        return { content: body, images };
    }
    return body;
}
