/** Default maximum tool result size (chars) before persisting to disk. */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

/** Approximate bytes per token for size heuristics. */
export const BYTES_PER_TOKEN = 4;

/** Max aggregate tool-result chars per assistant tool round (parallel tools). */
export const MAX_TOOL_RESULTS_PER_ROUND_CHARS = 200_000;

/** Preview size (chars) shown when a large result is persisted. */
export const TOOL_RESULT_PREVIEW_CHARS = 2000;

export const PERSISTED_OUTPUT_TAG = "<persisted-output>";
export const PERSISTED_OUTPUT_CLOSING_TAG = "</persisted-output>";

export const TOOL_RESULT_CLEARED_MESSAGE = "[Old tool result content cleared]";

export function resolveMaxResultSizeChars(maxResultSizeChars) {
    if (maxResultSizeChars === Infinity) {
        return Infinity;
    }
    if (
        typeof maxResultSizeChars === "number" &&
        Number.isFinite(maxResultSizeChars) &&
        maxResultSizeChars > 0
    ) {
        return Math.min(maxResultSizeChars, DEFAULT_MAX_RESULT_SIZE_CHARS);
    }
    return DEFAULT_MAX_RESULT_SIZE_CHARS;
}

export function formatByteSize(bytes) {
    if (bytes >= 1_000_000) {
        return `${(bytes / 1_000_000).toFixed(1)} MB`;
    }
    if (bytes >= 1000) {
        return `${(bytes / 1000).toFixed(1)} KB`;
    }
    return `${bytes} B`;
}
