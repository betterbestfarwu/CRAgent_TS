export const COLOR_SCHEME_STORAGE_KEY = "cragent.colorScheme";

export function systemPrefersDark() {
  return Boolean(window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
}

export function readStoredColorScheme() {
  try {
    const raw = localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // ignore
  }
  return null;
}

export function getEffectiveColorScheme(stored = readStoredColorScheme()) {
  if (stored === "light" || stored === "dark") return stored;
  return systemPrefersDark() ? "dark" : "light";
}

function syncHighlightStylesheets(doc, effectiveScheme) {
  doc?.querySelectorAll?.("link[data-theme-stylesheet]")?.forEach((link) => {
    const linkTheme = link.getAttribute("data-theme-stylesheet");
    link.disabled = linkTheme !== effectiveScheme;
  });
}

export function applyColorSchemeToDocument(doc, storedScheme) {
  const root = doc?.documentElement;
  if (!root) return;

  if (storedScheme === "light" || storedScheme === "dark") {
    root.dataset.theme = storedScheme;
  } else {
    delete root.dataset.theme;
  }

  const effective = getEffectiveColorScheme(storedScheme);
  syncHighlightStylesheets(doc, effective);
}

function syncColorSchemeToWindowChrome(storedScheme) {
  window.cragent?.syncColorScheme?.(getEffectiveColorScheme(storedScheme));
}

export function applyColorScheme(storedScheme = readStoredColorScheme()) {
  applyColorSchemeToDocument(document, storedScheme);
  syncColorSchemeToChatFrames(storedScheme);
  syncColorSchemeToWindowChrome(storedScheme);
}

export function syncColorSchemeToChatFrames(storedScheme = readStoredColorScheme()) {
  document.querySelectorAll("iframe.chat-frame").forEach((frame) => {
    applyColorSchemeToDocument(frame.contentDocument, storedScheme);
  });
}

export function setColorScheme(scheme) {
  try {
    if (scheme === "light" || scheme === "dark") {
      localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme);
    } else {
      localStorage.removeItem(COLOR_SCHEME_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  applyColorScheme(scheme);
}

export function toggleColorScheme() {
  const next = getEffectiveColorScheme() === "dark" ? "light" : "dark";
  setColorScheme(next);
  return next;
}

export function initColorScheme() {
  const stored = readStoredColorScheme();
  applyColorScheme(stored);
  return getEffectiveColorScheme(stored);
}
