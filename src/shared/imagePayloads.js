const INLINE_IMAGE_DATA_URL_RE =
    /\bdata:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)/g;
const JSON_IMAGE_B64_RE =
    /("(?:b64_json|image_base64|base64_image)"\s*:\s*")([A-Za-z0-9+/=]{1024,})(")/g;
const JSON_IMAGE_DATA_BEFORE_MIME_RE =
    /("data"\s*:\s*")([A-Za-z0-9+/=]{1024,})("(?=[^{}]{0,300}"mime(?:Type|_type)"\s*:\s*"image\/))/g;
const JSON_IMAGE_DATA_AFTER_MIME_RE =
    /((?:"mime(?:Type|_type)"\s*:\s*"image\/[^"]+"[^{}]{0,300}"data"\s*:\s*"))([A-Za-z0-9+/=]{1024,})(")/g;
const JSON_IMAGE_TYPE_DATA_RE =
    /((?:"type"\s*:\s*"image"[^{}]{0,300}"data"\s*:\s*"))([A-Za-z0-9+/=]{1024,})(")/g;
const MARKDOWN_IMAGE_DATA_URL_RE =
    /!\[([^\]]*)\]\(\s*data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)\s*\)/g;

function base64Bytes(encoded) {
    const clean = String(encoded || "").replace(/\s/g, "");
    if (!clean) {
        return 0;
    }
    const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function imagePayloadPlaceholder(mimeType = "image", encoded = "") {
    const bytes = base64Bytes(encoded);
    const size = bytes > 0 ? `, ${bytes} bytes` : "";
    return `[image payload omitted: ${mimeType}${size}]`;
}

export function stripInlineImagePayloads(text) {
    const value = String(text || "");
    if (!value) {
        return "";
    }

    return value
        .replace(INLINE_IMAGE_DATA_URL_RE, (_match, mimeType, encoded) =>
            imagePayloadPlaceholder(mimeType, encoded),
        )
        .replace(JSON_IMAGE_B64_RE, (_match, prefix, encoded, suffix) =>
            `${prefix}${imagePayloadPlaceholder("image", encoded)}${suffix}`,
        )
        .replace(JSON_IMAGE_DATA_BEFORE_MIME_RE, (_match, prefix, encoded, suffix) =>
            `${prefix}${imagePayloadPlaceholder("image", encoded)}${suffix}`,
        )
        .replace(JSON_IMAGE_DATA_AFTER_MIME_RE, (_match, prefix, encoded, suffix) =>
            `${prefix}${imagePayloadPlaceholder("image", encoded)}${suffix}`,
        )
        .replace(JSON_IMAGE_TYPE_DATA_RE, (_match, prefix, encoded, suffix) =>
            `${prefix}${imagePayloadPlaceholder("image", encoded)}${suffix}`,
        );
}

export function hasInlineImagePayloads(text) {
    INLINE_IMAGE_DATA_URL_RE.lastIndex = 0;
    MARKDOWN_IMAGE_DATA_URL_RE.lastIndex = 0;
    const value = String(text || "");
    return INLINE_IMAGE_DATA_URL_RE.test(value) || MARKDOWN_IMAGE_DATA_URL_RE.test(value);
}

function toDataUrl(mimeType, encoded) {
    return `data:${mimeType};base64,${String(encoded || "").replace(/\s/g, "")}`;
}

export function extractInlineImagePayloads(text) {
    const value = String(text || "");
    if (!value) {
        return { text: "", images: [], changed: false };
    }

    const images = [];
    let changed = false;
    const withoutMarkdownImages = value.replace(
        MARKDOWN_IMAGE_DATA_URL_RE,
        (_match, _alt, mimeType, encoded) => {
            images.push({ mimeType, dataUrl: toDataUrl(mimeType, encoded) });
            changed = true;
            return "";
        },
    );

    const withoutInlineImages = withoutMarkdownImages.replace(
        INLINE_IMAGE_DATA_URL_RE,
        (_match, mimeType, encoded) => {
            images.push({ mimeType, dataUrl: toDataUrl(mimeType, encoded) });
            changed = true;
            return imagePayloadPlaceholder(mimeType, encoded);
        },
    );

    const sanitized = stripInlineImagePayloads(withoutInlineImages).trim();
    return {
        text: sanitized,
        images,
        changed: changed || sanitized !== value,
    };
}
