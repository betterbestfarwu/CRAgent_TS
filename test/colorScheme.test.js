import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  COLOR_SCHEME_STORAGE_KEY,
  applyColorSchemeToDocument,
  getEffectiveColorScheme,
  readStoredColorScheme,
  toggleColorScheme,
} from "../src/shared/colorScheme.js";

const originals = {
  window: globalThis.window,
  document: globalThis.document,
  localStorage: globalThis.localStorage,
};

function installBrowserMock({ prefersDark = false, stored = null } = {}) {
  const store = new Map();
  if (stored) {
    store.set(COLOR_SCHEME_STORAGE_KEY, stored);
  }

  const root = { dataset: {} };
  const links = [];

  globalThis.window = {
    matchMedia: (query) => ({
      matches: query.includes("dark") ? prefersDark : !prefersDark,
      addEventListener() {},
      removeEventListener() {},
    }),
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        store.set(key, value);
      },
      removeItem: (key) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
    document: {
      documentElement: root,
      querySelectorAll: (selector) => {
        if (selector === "iframe.chat-frame") return [];
        if (selector === "link[data-theme-stylesheet]") return links;
        return [];
      },
    },
  };
  globalThis.document = globalThis.window.document;
  globalThis.localStorage = globalThis.window.localStorage;

  return { root, links, store };
}

afterEach(() => {
  globalThis.window = originals.window;
  globalThis.document = originals.document;
  globalThis.localStorage = originals.localStorage;
});

describe("colorScheme", () => {
  it("prefers stored scheme over system preference", () => {
    installBrowserMock({ prefersDark: true, stored: "light" });
    assert.equal(getEffectiveColorScheme(), "light");
    assert.equal(readStoredColorScheme(), "light");
  });

  it("falls back to system preference when unset", () => {
    installBrowserMock({ prefersDark: true });
    assert.equal(getEffectiveColorScheme(), "dark");

    installBrowserMock({ prefersDark: false });
    assert.equal(getEffectiveColorScheme(), "light");
  });

  it("toggleColorScheme switches between light and dark", () => {
    const { root } = installBrowserMock({ stored: "light" });
    assert.equal(toggleColorScheme(), "dark");
    assert.equal(root.dataset.theme, "dark");
    assert.equal(toggleColorScheme(), "light");
    assert.equal(root.dataset.theme, "light");
  });

  it("applyColorSchemeToDocument enables the matching highlight stylesheet", () => {
    const { links } = installBrowserMock();
    const light = { getAttribute: () => "light", disabled: false };
    const dark = { getAttribute: () => "dark", disabled: false };
    links.push(light, dark);

    applyColorSchemeToDocument(globalThis.document, "dark");
    assert.equal(light.disabled, true);
    assert.equal(dark.disabled, false);

    applyColorSchemeToDocument(globalThis.document, "light");
    assert.equal(light.disabled, false);
    assert.equal(dark.disabled, true);
  });
});
