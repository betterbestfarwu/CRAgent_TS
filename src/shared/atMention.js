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

/** @typedef {{ name: string, relativePath: string }} AtMentionRef */

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
 * @param {string} text
 * @param {AtMentionRef[]} mentions
 * @returns {string}
 */
export function buildInputWithAtMentions(text, mentions) {
    const mentionPart = (mentions || [])
        .map((mention) => `@${mention.relativePath}`)
        .filter(Boolean)
        .join(" ");
    const trimmed = String(text ?? "").trim();
    if (!mentionPart) return trimmed;
    return trimmed ? `${trimmed} ${mentionPart}` : mentionPart;
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
