/** Matches `buildInputWithFiles` in App.jsx. */
const ATTACHED_FILES_BLOCK_RE =
    /(?:^|\n\n)已附加文件：\n((?:- .+\n)+)\n请先阅读这些文件，再继续处理当前任务。\s*$/;

/**
 * @param {string} content
 * @returns {{ text: string, files: Array<{ path: string, name: string }> }}
 */
export function parseAttachedFilesFromContent(content) {
    const value = String(content ?? "");
    const match = value.match(ATTACHED_FILES_BLOCK_RE);
    if (!match) {
        return { text: value.trim(), files: [] };
    }

    const files = match[1]
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            const path = line.replace(/^- /, "").trim();
            const parts = path.split(/[/\\]/);
            const name = parts[parts.length - 1] || path;
            return { path, name };
        });

    return { text: value.slice(0, match.index).trim(), files };
}

/**
 * @param {{ role?: string, content?: string, userText?: string | null, atMentions?: Array<{ name?: string, relativePath?: string }>, images?: Array<{ mimeType?: string, dataUrl?: string }> }} message
 * @returns {{ text: string, images: Array<{ id: string, mimeType: string, dataUrl: string, name: string }>, mentions: Array<{ id: string, name: string, relativePath: string, insertAt: number, attachSeq: number }>, files: Array<{ id: string, name: string, size: number, path: string, insertAt: number, attachSeq: number }>, nextAttachSeq: number }}
 */
export function buildComposerRetryState(message) {
    const content = String(message?.content ?? "");
    const { text: contentText, files: parsedFiles } = parseAttachedFilesFromContent(content);
    const text = message?.userText != null ? String(message.userText).trim() : contentText;

    let attachSeq = 0;
    const mentions = (message?.atMentions || []).map((mention) => ({
        id: crypto.randomUUID(),
        name: String(mention?.name ?? "").trim(),
        relativePath: String(mention?.relativePath ?? "").trim(),
        insertAt: text.length,
        attachSeq: attachSeq++,
    }));

    const files = parsedFiles.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        size: 0,
        path: file.path,
        insertAt: text.length,
        attachSeq: attachSeq++,
    }));

    const images = (message?.images || [])
        .filter((image) => image?.dataUrl && image?.mimeType)
        .map((image, index) => ({
            id: crypto.randomUUID(),
            mimeType: image.mimeType,
            dataUrl: image.dataUrl,
            name: `image-${index + 1}`,
        }));

    return { text, images, mentions, files, nextAttachSeq: attachSeq };
}

/**
 * Like buildComposerRetryState, but loads stored session images when dataUrl was stripped.
 *
 * @param {{ id?: string, role?: string, content?: string, userText?: string | null, atMentions?: Array<{ name?: string, relativePath?: string }>, images?: Array<{ mimeType?: string, dataUrl?: string, hasData?: boolean, imageFile?: string, index?: number }> }} message
 * @param {{ sessionId?: string, getSessionImage?: (args: { sessionId?: string, messageId?: string, imageIndex?: number, imageFile?: string, mimeType?: string }) => Promise<{ mimeType?: string, dataUrl?: string } | null | undefined> }} [options]
 */
export async function buildComposerRestoreStateAsync(message, options = {}) {
    const base = buildComposerRetryState(message);
    const images = message?.images || [];
    if (!images.length || base.images.length === images.length) {
        return base;
    }

    const getSessionImage = options.getSessionImage;
    if (typeof getSessionImage !== "function") {
        return base;
    }

    const sessionId = String(options.sessionId || "").trim();
    const loaded = [];
    for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        if (image?.dataUrl && image?.mimeType) {
            loaded.push({
                id: crypto.randomUUID(),
                mimeType: image.mimeType,
                dataUrl: image.dataUrl,
                name: `image-${index + 1}`,
            });
            continue;
        }
        if (!image?.hasData && !image?.imageFile) {
            continue;
        }
        try {
            const resolved = await getSessionImage({
                sessionId,
                messageId: message?.id,
                imageIndex: image?.index ?? index,
                imageFile: image?.imageFile,
                mimeType: image?.mimeType,
            });
            if (resolved?.dataUrl) {
                loaded.push({
                    id: crypto.randomUUID(),
                    mimeType: resolved.mimeType || image.mimeType || "image/png",
                    dataUrl: resolved.dataUrl,
                    name: `image-${index + 1}`,
                });
            }
        } catch {
            // Skip images that cannot be resolved.
        }
    }

    return { ...base, images: loaded };
}
