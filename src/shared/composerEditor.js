/** @typedef {{ id: string, name: string, relativePath: string, insertAt?: number }} ComposerEditorMention */

/** @typedef {{ id: string, insertAt: number }} ComposerEditorFileRef */

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
 * @returns {{ text: string, mentions: ComposerEditorMention[], files: ComposerEditorFileRef[] }}
 */
export function parseComposerEditorDom(root, mentionById) {
    const mentions = [];
    /** @type {ComposerEditorFileRef[]} */
    const files = [];
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
        if (el.dataset?.fileId && el.classList.contains("composer-file-chip")) {
            files.push({
                id: el.dataset.fileId,
                insertAt: text.length,
            });
            return;
        }

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

    return { text: normalizeComposerEditorText(text), mentions, files };
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
export function getComposerFileBeforeSelection(root) {
    return findFileIdOnNode(findComposerChipNodeBeforeSelection(root));
}

/**
 * @param {Node | null | undefined} node
 * @returns {string | null}
 */
function findFileIdOnNode(node) {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE) {
        const element = /** @type {HTMLElement} */ (node);
        if (element.classList.contains("composer-file-chip") && element.dataset.fileId) {
            return element.dataset.fileId;
        }
    }
    return null;
}

/**
 * @param {Node | null | undefined} previous
 * @returns {Node | null | undefined}
 */
function skipEmptyComposerTextSiblings(previous) {
    let node = previous;
    while (node?.nodeType === Node.TEXT_NODE && !normalizeComposerEditorText(node.textContent ?? "").length) {
        node = node.previousSibling;
    }
    return node;
}

/**
 * @param {string} normalizedBefore
 * @param {string} normalizedNode
 * @returns {boolean}
 */
export function shouldComposerBackspaceRemoveChip(normalizedBefore, normalizedNode) {
    if (!normalizedNode.length) {
        return true;
    }
    return normalizedBefore.length === 0 || /^\s+$/.test(normalizedBefore);
}

/**
 * Whether ArrowLeft should jump before a chip instead of moving one character left.
 * @param {Node} textNode
 * @param {number} offset
 * @returns {boolean}
 */
export function shouldComposerArrowLeftJumpBeforeChip(textNode, offset) {
    if (textNode.nodeType !== Node.TEXT_NODE) return false;
    if (offset === 0) return true;
    const raw = textNode.nodeValue ?? "";
    return normalizeComposerEditorText(raw).length === 0;
}

/**
 * @param {Node} textNode
 * @param {number} offset
 * @template T
 * @param {(node: Node | null | undefined) => T | null} findIdOnNode
 * @returns {T | null}
 */
function findComposerChipBeforeTextCursor(textNode, offset, findIdOnNode) {
    if (textNode.nodeType !== Node.TEXT_NODE) return null;

    const raw = textNode.nodeValue ?? "";

    if (offset === 0) {
        return findIdOnNode(skipEmptyComposerTextSiblings(textNode.previousSibling));
    }

    if (offset > 0) {
        const normalizedBefore = normalizeComposerEditorText(raw.slice(0, offset));
        const normalizedNode = normalizeComposerEditorText(raw);
        if (shouldComposerBackspaceRemoveChip(normalizedBefore, normalizedNode)) {
            return findIdOnNode(skipEmptyComposerTextSiblings(textNode.previousSibling));
        }
    }

    return null;
}

export function getComposerMentionBeforeSelection(root) {
    return findMentionIdOnNode(findComposerChipNodeBeforeSelection(root));
}

/**
 * Non-editable mention/file chip immediately after the collapsed selection.
 * @param {HTMLElement | null} root
 * @returns {{ mentionId?: string, fileId?: string } | null}
 */
export function getComposerChipAfterSelection(root) {
    const chip = findComposerChipNodeAfterSelection(root);
    if (!chip) return null;
    if (chip.dataset?.mentionId) {
        return { mentionId: chip.dataset.mentionId };
    }
    if (chip.dataset?.fileId) {
        return { fileId: chip.dataset.fileId };
    }
    return null;
}

/**
 * @param {HTMLElement | null} root
 * @returns {boolean}
 */
export function moveComposerCaretBeforeChipBeforeSelection(root) {
    if (!root) return false;
    const chip = findComposerChipNodeBeforeSelection(root);
    if (!chip) return false;
    return placeComposerSelectionBeforeChip(root, chip);
}

/**
 * @param {HTMLElement | null} root
 * @returns {boolean}
 */
export function moveComposerCaretLeftBeforeChipIfNeeded(root) {
    if (!root) return false;
    const chip = findComposerChipNodeBeforeSelectionForArrowLeft(root);
    if (!chip) return false;
    return placeComposerSelectionBeforeChip(root, chip);
}

/**
 * @param {HTMLElement} root
 * @param {HTMLElement} chip
 * @returns {boolean}
 */
function placeComposerSelectionBeforeChip(root, chip) {
    const range = document.createRange();
    range.setStartBefore(chip);
    range.collapse(true);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (typeof root.focus === "function") {
        root.focus({ preventScroll: true });
    }
    return true;
}

/**
 * @param {HTMLElement | null} root
 * @returns {HTMLElement | null}
 */
function findComposerChipNodeBeforeSelection(root) {
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
            const chip = findComposerChipOnNode(skipEmptyComposerTextSiblings(previous));
            if (chip) return chip;
        }
        if (offset === 0 && element.classList?.contains("composer-at-chip")) {
            return element;
        }
    }

    if (node.nodeType === Node.TEXT_NODE && offset === 0) {
        return findComposerChipBeforeTextCursor(node, 0, findComposerChipOnNode);
    }

    if (node.nodeType === Node.TEXT_NODE && offset > 0) {
        return findComposerChipBeforeTextCursor(node, offset, findComposerChipOnNode);
    }

    if (node === root && offset > 0) {
        const previous = root.childNodes[offset - 1];
        return findComposerChipOnNode(skipEmptyComposerTextSiblings(previous));
    }

    return null;
}

/**
 * @param {HTMLElement | null} root
 * @returns {HTMLElement | null}
 */
function findComposerChipNodeBeforeSelectionForArrowLeft(root) {
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
            const chip = findComposerChipOnNode(skipEmptyComposerTextSiblings(previous));
            if (chip) return chip;
        }
        if (offset === 0 && element.classList?.contains("composer-at-chip")) {
            return element;
        }
    }

    if (node.nodeType === Node.TEXT_NODE && offset === 0) {
        return findComposerChipBeforeTextCursorForArrowLeft(node, 0, findComposerChipOnNode);
    }

    if (node.nodeType === Node.TEXT_NODE && offset > 0) {
        return findComposerChipBeforeTextCursorForArrowLeft(node, offset, findComposerChipOnNode);
    }

    if (node === root && offset > 0) {
        const previous = root.childNodes[offset - 1];
        return findComposerChipOnNode(skipEmptyComposerTextSiblings(previous));
    }

    return null;
}

/**
 * @param {Node} textNode
 * @param {number} offset
 * @template T
 * @param {(node: Node | null | undefined) => T | null} findIdOnNode
 * @returns {T | null}
 */
function findComposerChipBeforeTextCursorForArrowLeft(textNode, offset, findIdOnNode) {
    if (textNode.nodeType !== Node.TEXT_NODE) return null;

    if (offset === 0) {
        return findIdOnNode(skipEmptyComposerTextSiblings(textNode.previousSibling));
    }

    if (offset > 0 && shouldComposerArrowLeftJumpBeforeChip(textNode, offset)) {
        return findIdOnNode(skipEmptyComposerTextSiblings(textNode.previousSibling));
    }

    return null;
}

/**
 * @param {HTMLElement | null} root
 * @returns {HTMLElement | null}
 */
function findComposerChipNodeAfterSelection(root) {
    if (!root) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (!range.collapsed || !root.contains(range.startContainer)) return null;

    const node = range.startContainer;
    const offset = range.startOffset;

    if (node.nodeType === Node.ELEMENT_NODE) {
        const element = /** @type {HTMLElement} */ (node);
        return findComposerChipOnNode(element.childNodes[offset]);
    }

    if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.nodeValue ?? "";
        if (offset < raw.length) return null;

        let next = node.nextSibling;
        while (next?.nodeType === Node.TEXT_NODE && !normalizeComposerEditorText(next.textContent ?? "").length) {
            const chip = findComposerChipOnNode(next.nextSibling);
            if (chip) return chip;
            next = next.nextSibling;
        }
        return findComposerChipOnNode(next);
    }

    return null;
}

/**
 * @param {Node | null | undefined} node
 * @returns {HTMLElement | null}
 */
function findComposerChipOnNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
    const element = /** @type {HTMLElement} */ (node);
    if (element.classList.contains("composer-at-chip")) return element;
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
 * Logical text offset of the collapsed selection in a composer contenteditable root.
 * Matches {@link parseComposerEditorDom} text coordinates (chips contribute no characters).
 * @param {HTMLElement | null | undefined} root
 * @returns {number}
 */
export function getComposerEditorCaretOffset(root) {
    if (!root) return 0;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
        return normalizeComposerEditorText(parseComposerEditorDom(root, new Map()).text).length;
    }

    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) {
        return normalizeComposerEditorText(parseComposerEditorDom(root, new Map()).text).length;
    }

    const endContainer = range.startContainer;
    const endOffset = range.startOffset;
    let offset = 0;
    let found = false;

    /**
     * @param {Node} node
     * @param {boolean} blockBreakAfter
     */
    function visit(node, blockBreakAfter = false) {
        if (found) return;
        if (node.nodeType === Node.TEXT_NODE) {
            const raw = node.nodeValue ?? "";
            const normalized = normalizeComposerEditorText(raw);
            if (node === endContainer) {
                const rawBefore = raw.slice(0, endOffset);
                offset += normalizeComposerEditorText(rawBefore).length;
                found = true;
                return;
            }
            offset += normalized.length;
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const el = /** @type {HTMLElement} */ (node);
        if (el.dataset?.fileId && el.classList.contains("composer-file-chip")) {
            return;
        }
        if (el.dataset?.mentionId && el.classList.contains("composer-at-chip")) {
            return;
        }

        if (el.tagName === "BR") {
            if (node === endContainer && endOffset === 0) {
                found = true;
                return;
            }
            offset += 1;
            return;
        }

        const isBlock = el.tagName === "DIV" || el.tagName === "P";
        const children = Array.from(el.childNodes);
        for (let index = 0; index < children.length; index += 1) {
            if (found) break;
            if (node === endContainer && node.nodeType === Node.ELEMENT_NODE && endOffset === index) {
                found = true;
                break;
            }
            visit(children[index], index < children.length - 1 && isBlock);
        }
        if (found) return;
        if (node === endContainer && node.nodeType === Node.ELEMENT_NODE && endOffset === children.length) {
            found = true;
            return;
        }
        if (isBlock && el !== root && blockBreakAfter) {
            if (offset > 0) offset += 1;
        }
    }

    const children = Array.from(root.childNodes);
    for (let index = 0; index < children.length; index += 1) {
        if (found) break;
        visit(children[index], index < children.length - 1);
    }

    if (!found) {
        return normalizeComposerEditorText(parseComposerEditorDom(root, new Map()).text).length;
    }
    return offset;
}

/**
 * @param {string} raw
 * @param {number} normalizedPrefixLength
 * @returns {number}
 */
function rawOffsetForNormalizedPrefix(raw, normalizedPrefixLength) {
    if (normalizedPrefixLength <= 0) return 0;
    let normalized = 0;
    for (let index = 0; index < raw.length; index += 1) {
        if (raw[index] === COMPOSER_CARET_ZWSP) continue;
        normalized += 1;
        if (normalized >= normalizedPrefixLength) {
            return index + 1;
        }
    }
    return raw.length;
}

/**
 * Place a collapsed selection at a logical text offset in the composer editor.
 * @param {HTMLElement} root
 * @param {number} targetOffset
 * @returns {boolean}
 */
export function placeComposerCaretAtOffset(root, targetOffset) {
    const goal = Math.max(0, Math.floor(targetOffset));
    let cursor = 0;
    let placed = false;
    const range = document.createRange();

    /**
     * @param {Node} node
     * @param {boolean} blockBreakAfter
     */
    function visit(node, blockBreakAfter = false) {
        if (placed) return;
        if (node.nodeType === Node.TEXT_NODE) {
            const raw = node.nodeValue ?? "";
            const normalizedLength = normalizeComposerEditorText(raw).length;
            if (goal <= cursor) {
                range.setStart(node, 0);
                range.collapse(true);
                placed = true;
                return;
            }
            if (goal <= cursor + normalizedLength) {
                const rawOffset = rawOffsetForNormalizedPrefix(raw, goal - cursor);
                range.setStart(node, rawOffset);
                range.collapse(true);
                placed = true;
                return;
            }
            cursor += normalizedLength;
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const el = /** @type {HTMLElement} */ (node);
        if (
            (el.dataset?.fileId && el.classList.contains("composer-file-chip")) ||
            (el.dataset?.mentionId && el.classList.contains("composer-at-chip"))
        ) {
            if (goal <= cursor) {
                range.setStartBefore(node);
                range.collapse(true);
                placed = true;
            }
            return;
        }

        if (el.tagName === "BR") {
            if (goal <= cursor) {
                range.setStartBefore(node);
                range.collapse(true);
                placed = true;
                return;
            }
            cursor += 1;
            return;
        }

        const isBlock = el.tagName === "DIV" || el.tagName === "P";
        const children = Array.from(el.childNodes);
        for (let index = 0; index < children.length; index += 1) {
            visit(children[index], index < children.length - 1 && isBlock);
            if (placed) return;
        }
        if (isBlock && el !== root && blockBreakAfter) {
            if (cursor > 0) cursor += 1;
        }
    }

    const children = Array.from(root.childNodes);
    for (let index = 0; index < children.length; index += 1) {
        if (placed) break;
        if (goal <= cursor) {
            range.setStart(root, index);
            range.collapse(true);
            placed = true;
            break;
        }
        visit(children[index], index < children.length - 1);
    }

    if (!placed) {
        placeComposerCaretAtEnd(root);
        return false;
    }

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
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

/**
 * @param {HTMLElement | null | undefined} root
 * @param {number} offset
 */
export function restoreComposerEditorCaretAtOffset(root, offset) {
    if (!root) return;
    const apply = () => {
        placeComposerCaretAtOffset(root, offset);
        if (typeof root.focus === "function") {
            root.focus({ preventScroll: true });
        }
    };
    apply();
    requestAnimationFrame(apply);
    window.setTimeout(apply, 0);
}
