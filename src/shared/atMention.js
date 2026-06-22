/** @typedef {{ name: string, kind: "dir" | "file", relativePath: string }} ProjectDirEntry */

const CJK_CHAR_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * @param {string | null | undefined} char
 * @returns {boolean}
 */
export function isCjkChar(char) {
    return CJK_CHAR_PATTERN.test(String(char ?? ""));
}

/**
 * @param {string} query
 * @returns {boolean}
 */
export function looksLikeEmailDomainQuery(query) {
    return /^[\w%+.-]*\.[\w.-]+/.test(String(query ?? ""));
}

/**
 * @param {string} query
 * @param {boolean} explicitMention
 * @returns {boolean}
 */
export function isFileMentionQuery(query, explicitMention) {
    const value = String(query ?? "");
    if (!value) return true;
    if (/[/\\]/.test(value)) return true;
    if (/^[\w.%+\-]*$/.test(value)) return true;
    if (CJK_CHAR_PATTERN.test(value)) {
        return explicitMention;
    }
    return false;
}

/**
 * Active `@` mention at the composer caret (or end of text when caret is omitted).
 * @param {string} text
 * @param {number} [caretIndex]
 * @returns {{ query: string, mentionStart: number, mentionEnd: number } | null}
 */
export function parseActiveAtMention(text, caretIndex) {
    const value = String(text ?? "");
    const caret =
        typeof caretIndex === "number" && Number.isFinite(caretIndex)
            ? Math.max(0, Math.min(caretIndex, value.length))
            : value.length;
    const before = value.slice(0, caret);
    const atIndex = before.lastIndexOf("@");
    if (atIndex === -1) return null;

    const query = before.slice(atIndex + 1);
    if (/[\s@]/.test(query)) return null;

    const charBefore = atIndex > 0 ? before[atIndex - 1] : null;
    const atStart = atIndex === 0;
    const afterWhitespace = charBefore !== null && /\s/.test(charBefore);
    const afterAsciiWord = charBefore !== null && /[A-Za-z0-9_]/.test(charBefore);
    const explicitMention = atStart || afterWhitespace;

    if (afterAsciiWord && looksLikeEmailDomainQuery(query)) {
        return null;
    }

    if (!isFileMentionQuery(query, explicitMention)) {
        return null;
    }

    return {
        query,
        mentionStart: atIndex,
        mentionEnd: caret,
    };
}

/**
 * @param {{ key?: string, code?: string, shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean } | null | undefined} event
 * @returns {boolean}
 */
export function isAtSignKey(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === "@") return true;
    if (event.key === "2" && event.shiftKey) return true;
    if (event.code === "Digit2" && event.shiftKey) return true;
    return false;
}

/**
 * @param {{ mentionStart: number } | null | undefined} atMention
 * @param {number | null | undefined} manualStart
 * @returns {boolean}
 */
export function isActiveManualAtMention(atMention, manualStart) {
    if (!atMention || manualStart == null) return false;
    return manualStart === atMention.mentionStart;
}

/**
 * Split typed query after `@` into directory prefix and name filter.
 * @param {string} query
 * @returns {{ relativePath: string, filter: string }}
 */
export function splitAtQueryPath(query) {
    const q = String(query ?? "");
    if (!q) return { relativePath: "", filter: "" };
    if (!q.includes("/")) return { relativePath: "", filter: q };
    const slash = q.lastIndexOf("/");
    return {
        relativePath: q.slice(0, slash).replace(/^\/+/, "").replace(/\/+$/, ""),
        filter: q.slice(slash + 1),
    };
}

/**
 * @param {ProjectDirEntry[]} entries
 * @param {...string} filters
 * @returns {ProjectDirEntry[]}
 */
export function filterDirectoryEntries(entries, ...filters) {
    const needles = filters
        .map((filter) => String(filter ?? "").trim().toLowerCase())
        .filter(Boolean);
    if (!needles.length) return entries;
    return entries.filter((entry) => {
        const name = entry.name.toLowerCase();
        return needles.every((needle) => name.includes(needle));
    });
}

/**
 * @param {ProjectDirEntry[]} entries
 * @returns {ProjectDirEntry[]}
 */
export function sortDirectoryEntries(entries) {
    return [...entries].sort((a, b) => {
        if (a.kind !== b.kind) {
            return a.kind === "dir" ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}

/**
 * @param {string} relativePath
 * @param {string} [leafName]
 * @returns {string[]}
 */
export function buildPathTreeSegments(relativePath, leafName = "") {
    const parts = String(relativePath ?? "")
        .split(/[/\\]+/)
        .filter(Boolean);
    if (leafName && parts[parts.length - 1] !== leafName) {
        parts.push(leafName);
    }
    return parts;
}

/**
 * @param {ProjectDirEntry[]} entries
 * @param {string} browseRelativePath
 * @param {boolean} includeParent
 * @returns {Array<{ kind: "parent" } | { kind: "entry", entry: ProjectDirEntry }>}
 */
export function buildAtNavItems(entries, browseRelativePath, includeParent) {
    const items = [];
    if (includeParent && browseRelativePath) {
        items.push({ kind: "parent" });
    }
    for (const entry of entries) {
        items.push({ kind: "entry", entry });
    }
    return items;
}

/**
 * @param {string} parentRelativePath
 * @returns {string}
 */
export function parentRelativePath(parentRelativePath) {
    const normalized = String(parentRelativePath ?? "")
        .replace(/\\/g, "/")
        .replace(/\/+$/, "");
    if (!normalized) return "";
    const idx = normalized.lastIndexOf("/");
    return idx === -1 ? "" : normalized.slice(0, idx);
}

/**
 * Collapse `@path/to/file` mentions to `@filename` for user message display.
 * @param {string} text
 * @returns {string}
 */
export function formatAtMentionsForDisplay(text) {
    return String(text ?? "").replace(/@([^\s@]+)/g, (full, mentionPath) => {
        const raw = String(mentionPath ?? "").trim();
        if (!raw) return full;
        const parts = raw.split(/[/\\]/);
        const name = parts[parts.length - 1] || raw;
        return `@${name}`;
    });
}

/** @typedef {{ name: string, relativePath: string, insertAt?: number }} AtMentionRef */

/** @typedef {{ kind: "text", content: string } | { kind: "mention", mentionId: string }} ComposerSegment */

/** @typedef {{ kind: "text", content: string } | { kind: "mention", mentionId: string } | { kind: "file", fileId: string }} ComposerDisplaySegment */

/**
 * @param {string} text
 * @param {Array<{ id: string, insertAt?: number }>} mentions
 * @returns {ComposerSegment[]}
 */
export function buildComposerSegments(text, mentions) {
    const value = String(text ?? "");
    const sorted = [...(mentions || [])].sort(
        (a, b) => resolveMentionInsertAt(a, value.length) - resolveMentionInsertAt(b, value.length),
    );
    const segments = [];
    let cursor = 0;
    let index = 0;

    while (index < sorted.length) {
        const insertAt = resolveMentionInsertAt(sorted[index], value.length);
        if (insertAt > cursor) {
            segments.push({ kind: "text", content: value.slice(cursor, insertAt) });
            cursor = insertAt;
        }
        const groupAt = insertAt;
        while (
            index < sorted.length &&
            resolveMentionInsertAt(sorted[index], value.length) === groupAt
        ) {
            segments.push({ kind: "mention", mentionId: sorted[index].id });
            index += 1;
        }
    }

    if (cursor < value.length) {
        segments.push({ kind: "text", content: value.slice(cursor) });
    }

    if (!segments.length) {
        segments.push({ kind: "text", content: "" });
    } else if (segments[segments.length - 1].kind === "mention") {
        segments.push({ kind: "text", content: "" });
    }

    return segments;
}

/**
 * Merge text, @ mention chips, and dragged file chips in logical caret order.
 * @param {string} text
 * @param {Array<{ id: string, insertAt?: number }>} mentions
 * @param {Array<{ id: string, insertAt?: number }>} files
 * @returns {ComposerDisplaySegment[]}
 */
export function buildComposerDisplaySegments(text, mentions, files) {
    const value = String(text ?? "");
    const textLength = value.length;
    /** @type {Array<{ kind: "mention" | "file", id: string, insertAt: number, attachSeq: number }>} */
    const items = [];
    for (const mention of mentions || []) {
        items.push({
            kind: "mention",
            id: mention.id,
            insertAt: resolveMentionInsertAt(mention, textLength),
            attachSeq: typeof mention.attachSeq === "number" ? mention.attachSeq : Number.MAX_SAFE_INTEGER,
        });
    }
    for (const file of files || []) {
        items.push({
            kind: "file",
            id: file.id,
            insertAt: resolveMentionInsertAt(file, textLength),
            attachSeq: typeof file.attachSeq === "number" ? file.attachSeq : Number.MAX_SAFE_INTEGER,
        });
    }
    items.sort((a, b) => a.insertAt - b.insertAt || a.attachSeq - b.attachSeq);

    /** @type {ComposerDisplaySegment[]} */
    const segments = [];
    let cursor = 0;
    let index = 0;

    while (index < items.length) {
        const insertAt = items[index].insertAt;
        if (insertAt > cursor) {
            segments.push({ kind: "text", content: value.slice(cursor, insertAt) });
            cursor = insertAt;
        }
        const groupAt = insertAt;
        while (index < items.length && items[index].insertAt === groupAt) {
            const item = items[index];
            if (item.kind === "mention") {
                segments.push({ kind: "mention", mentionId: item.id });
            } else {
                segments.push({ kind: "file", fileId: item.id });
            }
            index += 1;
        }
    }

    if (cursor < textLength) {
        segments.push({ kind: "text", content: value.slice(cursor) });
    }

    if (!segments.length) {
        segments.push({ kind: "text", content: "" });
    } else if (segments[segments.length - 1].kind !== "text") {
        segments.push({ kind: "text", content: "" });
    }

    return segments;
}

/**
 * @param {{ insertAt?: number }} mention
 * @param {number} textLength
 * @returns {number}
 */
export function resolveMentionInsertAt(mention, textLength) {
    const raw = mention?.insertAt;
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return Math.max(0, Math.min(raw, textLength));
    }
    return textLength;
}

/**
 * @param {string} text
 * @param {number} segmentStart
 * @param {number} segmentEnd
 * @param {string} nextSegmentText
 * @param {Array<{ id: string, insertAt?: number }>} mentions
 * @returns {{ text: string, mentions: Array<{ id: string, insertAt?: number }> }}
 */
export function applyComposerTextSegmentEdit(text, segmentStart, segmentEnd, nextSegmentText, mentions) {
    const value = String(text ?? "");
    const start = Math.max(0, Math.min(segmentStart, value.length));
    const end = Math.max(start, Math.min(segmentEnd, value.length));
    const nextText = String(nextSegmentText ?? "");
    const delta = nextText.length - (end - start);
    const updatedText = value.slice(0, start) + nextText + value.slice(end);
    const updatedMentions = (mentions || []).map((mention) => {
        const insertAt = resolveMentionInsertAt(mention, value.length);
        if (insertAt <= start) return mention;
        return { ...mention, insertAt: insertAt + delta };
    });
    return { text: updatedText, mentions: updatedMentions };
}

/**
 * @param {string} relativePath
 * @returns {string}
 */
export function atMentionFileName(relativePath) {
    const parts = String(relativePath ?? "")
        .split(/[/\\]/)
        .filter(Boolean);
    return parts[parts.length - 1] || String(relativePath ?? "");
}

/**
 * Visible chip label (no leading @).
 * @param {string} name
 */
export function atChipDisplayName(name) {
    return String(name ?? "").replace(/^@+/, "");
}

/**
 * Insert a single space in plain text immediately after a mention insert position.
 * @param {string} text
 * @param {number} insertAt
 */
export function appendSpaceAfterInsertAt(text, insertAt) {
    const value = String(text ?? "");
    const at = Math.max(0, Math.min(insertAt, value.length));
    if (value.slice(at).startsWith(" ")) return value;
    return `${value.slice(0, at)} ${value.slice(at)}`;
}

/**
 * @param {string} text
 * @param {AtMentionRef[]} mentions
 * @returns {string}
 */
export function buildInputWithAtMentions(text, mentions) {
    const value = String(text ?? "");
    const list = [...(mentions || [])].sort(
        (a, b) => resolveMentionInsertAt(a, value.length) - resolveMentionInsertAt(b, value.length),
    );
    if (!list.length) return value.trim();

    let result = "";
    let cursor = 0;
    let index = 0;

    while (index < list.length) {
        const insertAt = resolveMentionInsertAt(list[index], value.length);
        if (insertAt > cursor) {
            result += value.slice(cursor, insertAt);
            cursor = insertAt;
        }
        const groupAt = insertAt;
        while (
            index < list.length &&
            resolveMentionInsertAt(list[index], value.length) === groupAt
        ) {
            const path = String(list[index].relativePath ?? "").trim();
            if (path) {
                if (result && !/\s$/.test(result)) result += " ";
                result += `@${path}`;
            }
            index += 1;
        }
    }

    if (cursor < value.length) {
        const suffix = value.slice(cursor);
        if (result && suffix && !/^\s/.test(suffix) && !/\s$/.test(result)) {
            result += " ";
        }
        result += suffix;
    }

    return result.trim();
}

/**
 * @param {unknown} mentions
 * @returns {AtMentionRef[]}
 */
export function normalizeAtMentions(mentions) {
    if (!Array.isArray(mentions)) return [];
    return mentions
        .map((mention) => {
            const relativePath = String(mention?.relativePath ?? mention?.relative_path ?? "").trim();
            if (!relativePath) return null;
            const name = String(mention?.name ?? "").trim() || atMentionFileName(relativePath);
            const rawInsertAt = mention?.insertAt ?? mention?.insert_at;
            const normalized = { name, relativePath };
            if (typeof rawInsertAt === "number" && Number.isFinite(rawInsertAt)) {
                normalized.insertAt = Math.max(0, rawInsertAt);
            }
            return normalized;
        })
        .filter(Boolean);
}
