import { applyColorSchemeToDocument, readStoredColorScheme } from "@shared/colorScheme.js";

const LAYOUT_VARS = [
  "--chat-gutter-x",
  "--chat-inner-x",
];

/** Copy shell chat layout tokens from the renderer into the chat iframe document. */
export function injectChatLayout(iframeDoc) {
  const target = iframeDoc?.documentElement;
  if (!target) return;

  const parentStyle = getComputedStyle(document.documentElement);
  for (const name of LAYOUT_VARS) {
    const value = parentStyle.getPropertyValue(name).trim();
    if (value) {
      target.style.setProperty(name, value);
    }
  }

  // Theme tokens must come from cursor-theme.css; injecting computed colors as inline
  // custom properties freezes them when the color scheme changes.
  target.style.removeProperty("--bg");
  target.style.removeProperty("--chat-bg");

  applyColorSchemeToDocument(iframeDoc, readStoredColorScheme());
}
