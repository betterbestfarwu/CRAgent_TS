const LAYOUT_VARS = [
  "--chat-gutter-x",
  "--chat-inner-x",
  "--chat-bg",
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

  const chatBg = parentStyle.getPropertyValue("--chat-bg").trim();
  if (chatBg) {
    target.style.setProperty("--bg", chatBg);
  }
}
