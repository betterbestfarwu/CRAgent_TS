export const CHAT_FONT_SCALE_STORAGE_KEY = "cragent.chatFontScale";
export const CHAT_FONT_SCALE_DEFAULT = 1;
export const CHAT_FONT_SCALE_MIN = 0.8;
export const CHAT_FONT_SCALE_MAX = 1.6;
export const CHAT_FONT_SCALE_STEP = 0.1;

export function clampChatFontScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return CHAT_FONT_SCALE_DEFAULT;
  }
  const rounded = Math.round(numeric * 10) / 10;
  return Math.min(CHAT_FONT_SCALE_MAX, Math.max(CHAT_FONT_SCALE_MIN, rounded));
}

export function readStoredChatFontScale() {
  try {
    const raw = localStorage.getItem(CHAT_FONT_SCALE_STORAGE_KEY);
    if (raw != null && raw !== "") {
      return clampChatFontScale(Number(raw));
    }
  } catch {
    // ignore
  }
  return CHAT_FONT_SCALE_DEFAULT;
}

export function storeChatFontScale(value) {
  try {
    localStorage.setItem(CHAT_FONT_SCALE_STORAGE_KEY, String(clampChatFontScale(value)));
  } catch {
    // ignore
  }
}

export function adjustChatFontScale(current, direction) {
  return clampChatFontScale(current + direction * CHAT_FONT_SCALE_STEP);
}

export function applyChatFontScaleToDocument(doc, scale) {
  const root = doc?.documentElement;
  if (!root) return;
  root.style.zoom = String(clampChatFontScale(scale));
}

/**
 * @param {{ key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean } | null | undefined} event
 * @returns {"in" | "out" | "reset" | null}
 */
export function chatFontScaleKeyAction(event) {
  if (!event || (!event.metaKey && !event.ctrlKey) || event.altKey) {
    return null;
  }
  if (event.key === "=" || event.key === "+") {
    return "in";
  }
  if (event.key === "-") {
    return "out";
  }
  if (event.key === "0") {
    return "reset";
  }
  return null;
}
