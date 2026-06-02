/** Normalize tool execute() return value (string or { text/content, images? }). */
export function normalizeToolResult(result) {
    if (result == null) {
        return { content: "", images: undefined };
    }
    if (typeof result === "string") {
        return { content: result, images: undefined };
    }
    if (typeof result === "object") {
        const content = String(result.text ?? result.content ?? "");
        const images = Array.isArray(result.images)
            ? result.images.filter((image) => image?.dataUrl && image?.mimeType)
            : undefined;
        return { content, images: images?.length ? images : undefined };
    }
    return { content: String(result), images: undefined };
}

export function isToolErrorResult(result) {
    const normalized = normalizeToolResult(result);
    return normalized.content.startsWith("Error:");
}

export function toolResultContent(result) {
    return normalizeToolResult(result).content;
}
