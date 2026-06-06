export const SESSION_IMAGE_SCHEME = "cragent-session";

export function buildSessionImageUrl(sessionId, imageFile) {
    const id = String(sessionId || "").trim();
    const file = String(imageFile || "").trim();
    if (!id || !file) {
        return "";
    }
    return `${SESSION_IMAGE_SCHEME}://local/${encodeURIComponent(id)}/${encodeURIComponent(file)}`;
}

export function parseSessionImageUrl(url) {
    try {
        const parsed = new URL(String(url || ""));
        if (parsed.protocol !== `${SESSION_IMAGE_SCHEME}:` || parsed.hostname !== "local") {
            return null;
        }
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts.length !== 2) {
            return null;
        }
        return {
            sessionId: decodeURIComponent(parts[0]),
            imageFile: decodeURIComponent(parts[1]),
        };
    } catch {
        return null;
    }
}
