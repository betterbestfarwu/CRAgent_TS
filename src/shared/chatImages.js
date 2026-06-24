export const MAX_CHAT_IMAGES = 5;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;

export function isImageFile(file) {
    return Boolean(file?.type?.startsWith("image/"));
}

export function validateImageFile(file) {
    if (!isImageFile(file)) {
        return { ok: false, error: "仅支持图片文件" };
    }
    if (file.size > MAX_CHAT_IMAGE_BYTES) {
        return { ok: false, error: "单张图片不能超过 5MB" };
    }
    return { ok: true };
}

export function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(file);
    });
}

function decodeHtmlAttribute(value) {
    return String(value || "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

export function extractHtmlImageDataUrls(html) {
    const value = String(html || "");
    if (!value) {
        return [];
    }

    const images = [];
    const imgRe = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
    let match;
    while ((match = imgRe.exec(value))) {
        const src = decodeHtmlAttribute(match[1] || match[2] || match[3] || "");
        if (/^data:image\/[A-Za-z0-9.+-]+;base64,/i.test(src)) {
            images.push(src);
        }
    }
    return images;
}

function mimeTypeFromDataUrl(dataUrl) {
    return (String(dataUrl || "").match(/^data:([^;,]+)[;,]/i) || [])[1] || "image/png";
}

function pastedImageName(mimeType) {
    switch (String(mimeType || "").toLowerCase()) {
        case "image/jpeg":
        case "image/jpg":
            return "pasted-image.jpg";
        case "image/webp":
            return "pasted-image.webp";
        case "image/gif":
            return "pasted-image.gif";
        case "image/png":
        default:
            return "pasted-image.png";
    }
}

export function htmlImageDataUrlsToAttachments(html, options = {}) {
    return imageDataUrlsToAttachments(extractHtmlImageDataUrls(html), options);
}

export function imageDataUrlsToAttachments(dataUrls, options = {}) {
    const idFactory = options.idFactory || (() => crypto.randomUUID());
    const available = Math.max(0, MAX_CHAT_IMAGES - (options.existingCount || 0));
    return (dataUrls || [])
        .filter((dataUrl) => /^data:image\/[A-Za-z0-9.+-]+;base64,/i.test(String(dataUrl || "")))
        .slice(0, available)
        .map((dataUrl) => {
            const mimeType = mimeTypeFromDataUrl(dataUrl);
            return {
                id: idFactory(),
                mimeType,
                dataUrl,
                name: pastedImageName(mimeType),
            };
        });
}

export async function filesToImageAttachments(files, existingCount = 0) {
    const accepted = [];
    const errors = [];
    const available = MAX_CHAT_IMAGES - existingCount;

    for (const file of files) {
        if (accepted.length >= available) {
            errors.push(`最多只能添加 ${MAX_CHAT_IMAGES} 张图片`);
            break;
        }
        const validation = validateImageFile(file);
        if (!validation.ok) {
            errors.push(file.name ? `${file.name}: ${validation.error}` : validation.error);
            continue;
        }
        try {
            const dataUrl = await readFileAsDataUrl(file);
            accepted.push({
                id: crypto.randomUUID(),
                mimeType: file.type,
                dataUrl,
                name: file.name || "image",
            });
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }

    return { accepted, errors };
}

export function toStoredImages(attachments) {
    return attachments.map(({ mimeType, dataUrl }) => ({ mimeType, dataUrl }));
}
