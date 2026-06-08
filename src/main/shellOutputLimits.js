export const BASH_MAX_OUTPUT_DEFAULT = 30_000;
export const BASH_MAX_OUTPUT_UPPER_LIMIT = 150_000;

export function getMaxBashOutputChars() {
    const raw = process.env.BASH_MAX_OUTPUT_LENGTH;
    if (!raw) {
        return BASH_MAX_OUTPUT_DEFAULT;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return BASH_MAX_OUTPUT_DEFAULT;
    }
    return Math.min(parsed, BASH_MAX_OUTPUT_UPPER_LIMIT);
}

/**
 * Truncate shell stdout/stderr bundle for LLM context. Prefers cutting at a newline.
 */
export function truncateShellOutput(content, maxChars = getMaxBashOutputChars()) {
    const text = String(content || "");
    if (text.length <= maxChars) {
        return text;
    }
    const truncatedPart = text.slice(0, maxChars);
    const lastNewline = truncatedPart.lastIndexOf("\n");
    const cutPoint = lastNewline > maxChars * 0.5 ? lastNewline : maxChars;
    const remainingLines = (text.slice(cutPoint).match(/\n/g) || []).length + 1;
    return `${text.slice(0, cutPoint)}\n\n... [${remainingLines} lines truncated] ...`;
}
