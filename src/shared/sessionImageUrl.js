export const SESSION_IMAGE_SCHEME = "cragent-session";

/** Matches externalizeSessionImages file naming: `{messageId}-{index}{ext}`. */
export function inferSessionImageFile(messageId, imageIndex = 0, mimeType = "") {
    const id = String(messageId || "").trim();
    if (!id) {
        return "";
    }
    const index = Math.max(0, Number(imageIndex) || 0);
    switch (String(mimeType || "").toLowerCase()) {
        case "image/jpeg":
        case "image/jpg":
            return `${id}-${index}.jpg`;
        case "image/webp":
            return `${id}-${index}.webp`;
        case "image/gif":
            return `${id}-${index}.gif`;
        case "image/png":
        default:
            return `${id}-${index}.png`;
    }
}

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

/** Build chat iframe wire fields for one message image. */
export function resolveSessionImageWireFields(sessionId, messageId, image, index, options = {}) {
    const useDirectImageSrc = options.useDirectImageSrc === true;
    const actualIndex = image?.index ?? index;
    const imageFile =
        String(image?.imageFile || "").trim() ||
        (useDirectImageSrc && sessionId && (image?.hasData || image?.dataUrl)
            ? inferSessionImageFile(messageId, actualIndex, image?.mimeType)
            : "");
    const imageSrc =
        useDirectImageSrc && sessionId && imageFile
            ? buildSessionImageUrl(sessionId, imageFile)
            : null;
    const dataUrl = useDirectImageSrc ? null : image?.dataUrl || null;

    return {
        index: actualIndex,
        mime_type: image?.mimeType || "",
        has_data: Boolean(image?.hasData || imageFile || image?.dataUrl),
        ...(imageFile ? { image_file: imageFile } : {}),
        ...(imageSrc ? { image_src: imageSrc } : {}),
        ...(dataUrl ? { data_url: dataUrl } : {}),
    };
}
