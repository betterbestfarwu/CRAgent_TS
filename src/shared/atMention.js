/** @typedef {{ name: string, kind: "dir" | "file", relativePath: string }} ProjectDirEntry */

/**
 * Active `@` mention at end of composer text.
 * @param {string} text
 * @returns {{ query: string, mentionStart: number, mentionEnd: number } | null}
 */
export function parseActiveAtMention(text) {
    const value = String(text ?? "");
    const match = value.match(/@([^\s@]*)$/);
    if (!match) return null;
    return {
        query: match[1],
        mentionStart: value.length - match[0].length,
        mentionEnd: value.length,
    };
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
 * @param {string} filter
 * @returns {ProjectDirEntry[]}
 */
export function filterDirectoryEntries(entries, filter) {
    const needle = String(filter ?? "").trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
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
            return { name, relativePath };
        })
        .filter(Boolean);
}
