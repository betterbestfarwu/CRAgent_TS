/** @typedef {{ id: string, name: string, relativePath: string, insertAt?: number }} ComposerEditorMention */

/** Invisible caret anchor after non-editable mention chips (contenteditable). */
export const COMPOSER_CARET_ZWSP = "\u200B";

/**
 * @param {string} text
 */
export function normalizeComposerEditorText(text) {
    return String(text ?? "").replace(/\u200B/g, "");
}

/**
 * @param {string} text
 * @param {Array<{ id: string, insertAt?: number }>} mentions
 */
export function composerEditorSnapshotKey(text, mentions) {
    const list = [...(mentions || [])]
        .map((mention) => `${mention.id}:${mention.insertAt ?? "end"}`)
        .sort();
    return `${normalizeComposerEditorText(text)}\0${list.join("\n")}`;
}

/**
 * @param {HTMLElement} root
 * @param {Map<string, { id: string, name: string, relativePath: string }>} mentionById
 * @returns {{ text: string, mentions: ComposerEditorMention[] }}
 */
export function parseComposerEditorDom(root, mentionById) {
    const mentions = [];
    let text = "";

    /**
     * @param {Node} node
     * @param {boolean} blockBreakAfter
     */
    function visit(node, blockBreakAfter = false) {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.nodeValue ?? "";
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const el = /** @type {HTMLElement} */ (node);
        const mentionId = el.dataset?.mentionId;
        if (mentionId && el.classList.contains("composer-at-chip")) {
            const known = mentionById.get(mentionId);
            if (known) {
                mentions.push({
                    id: known.id,
                    name: known.name,
                    relativePath: known.relativePath,
                    insertAt: text.length,
                });
            }
            return;
        }

        if (el.tagName === "BR") {
            text += "\n";
            return;
        }

        const isBlock = el.tagName === "DIV" || el.tagName === "P";
        const children = Array.from(el.childNodes);
        for (let index = 0; index < children.length; index += 1) {
            visit(children[index], index < children.length - 1 && isBlock);
        }
        if (isBlock && el !== root && blockBreakAfter) {
            if (text.length > 0 && !text.endsWith("\n")) {
                text += "\n";
            }
        }
    }

    const children = Array.from(root.childNodes);
    for (let index = 0; index < children.length; index += 1) {
        visit(children[index], index < children.length - 1);
    }

    return { text: normalizeComposerEditorText(text), mentions };
}

/**
 * @param {DocumentFragment} fragment
 */
export function ensureComposerCaretAnchor(fragment) {
    const last = fragment.lastChild;
    if (last?.nodeType === Node.TEXT_NODE) {
        const value = last.nodeValue ?? "";
        if (!value.endsWith(COMPOSER_CARET_ZWSP)) {
            last.nodeValue = value + COMPOSER_CARET_ZWSP;
        }
        return;
    }
    fragment.appendChild(document.createTextNode(COMPOSER_CARET_ZWSP));
}

/**
 * @param {HTMLElement | null} root
 * @returns {string | null}
 */
export function getComposerMentionBeforeSelection(root) {
    if (!root) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (!range.collapsed || !root.contains(range.startContainer)) return null;

    let node = range.startContainer;
    let offset = range.startOffset;

    if (node.nodeType === Node.ELEMENT_NODE) {
        const element = /** @type {HTMLElement} */ (node);
        if (offset > 0) {
            const previous = element.childNodes[offset - 1];
            const mentionId = findMentionIdOnNode(previous);
            if (mentionId) return mentionId;
        }
        if (offset === 0 && element.classList?.contains("composer-at-chip")) {
            return element.dataset.mentionId ?? null;
        }
    }

    if (node.nodeType === Node.TEXT_NODE && offset === 0) {
        let previous = node.previousSibling;
        while (previous?.nodeType === Node.TEXT_NODE && !(previous.textContent ?? "").length) {
            previous = previous.previousSibling;
        }
        const mentionId = findMentionIdOnNode(previous);
        if (mentionId) return mentionId;
    }

    if (node.nodeType === Node.TEXT_NODE && offset > 0) {
        return null;
    }

    if (node === root && offset > 0) {
        const previous = root.childNodes[offset - 1];
        return findMentionIdOnNode(previous);
    }

    return null;
}

/**
 * @param {Node | null | undefined} node
 * @returns {string | null}
 */
function findMentionIdOnNode(node) {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE) {
        const element = /** @type {HTMLElement} */ (node);
        if (element.classList.contains("composer-at-chip") && element.dataset.mentionId) {
            return element.dataset.mentionId;
        }
    }
    return null;
}

/**
 * @param {HTMLElement} root
 */
export function placeComposerCaretAtEnd(root) {
    const range = document.createRange();
    const last = root.lastChild;
    if (last?.nodeType === Node.TEXT_NODE) {
        const length = last.nodeValue?.length ?? 0;
        range.setStart(last, length);
        range.collapse(true);
    } else {
        const anchor = document.createTextNode(COMPOSER_CARET_ZWSP);
        root.appendChild(anchor);
        range.setStart(anchor, anchor.nodeValue?.length ?? 1);
        range.collapse(true);
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

/**
 * @param {HTMLElement | null | undefined} root
 */
export function restoreComposerEditorCaret(root) {
    if (!root) return;
    const apply = () => {
        placeComposerCaretAtEnd(root);
        if (typeof root.focus === "function") {
            root.focus({ preventScroll: true });
        }
    };
    apply();
    requestAnimationFrame(apply);
    window.setTimeout(apply, 0);
}
