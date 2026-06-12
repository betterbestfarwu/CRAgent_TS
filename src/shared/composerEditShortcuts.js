/**
 * @param {{ key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean } | null | undefined} event
 * @returns {"selectAll" | "copy" | "cut" | "paste" | null}
 */
export function composerEditShortcutAction(event) {
  if (!event || event.altKey) return null;
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = String(event.key ?? "").toLowerCase();
  if (key === "a") return "selectAll";
  if (key === "c") return "copy";
  if (key === "x") return "cut";
  if (key === "v") return "paste";
  return null;
}

/**
 * Apply Cmd/Ctrl+A/C/X in the composer. Paste is left to the browser paste event.
 * @param {KeyboardEvent} event
 * @param {{ contentEditable?: boolean, onAfterCut?: () => void }} [options]
 * @returns {boolean} true when the shortcut was handled
 */
export function applyComposerEditShortcut(event, options = {}) {
  const action = composerEditShortcutAction(event);
  if (!action || action === "paste") return false;

  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return false;

  if (action === "selectAll") {
    event.preventDefault();
    if (options.contentEditable) {
      document.execCommand("selectAll");
    } else if (target instanceof HTMLTextAreaElement) {
      target.select();
    }
    return true;
  }

  if (action === "copy" || action === "cut") {
    event.preventDefault();
    document.execCommand(action);
    if (action === "cut") {
      options.onAfterCut?.();
    }
    return true;
  }

  return false;
}
