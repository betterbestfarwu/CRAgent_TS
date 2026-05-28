export function estimateTokens(messages) {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.max(1, Math.round(totalChars / 4));
}
export function formatTokens(n) {
    if (n >= 1000000)
        return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000)
        return `${(n / 1000).toFixed(1)}k`;
    return `${n}`;
}
