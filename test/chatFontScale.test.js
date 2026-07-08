import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  CHAT_FONT_SCALE_DEFAULT,
  CHAT_FONT_SCALE_STORAGE_KEY,
  adjustChatFontScale,
  applyChatFontScale,
  applyChatFontScaleToDocument,
  chatFontScaleKeyAction,
  clampChatFontScale,
  nextChatFontScaleFromAction,
  readStoredChatFontScale,
  storeChatFontScale,
} from "../src/shared/chatFontScale.js";

const originals = {
  localStorage: globalThis.localStorage,
  document: globalThis.document,
};

function installStorageMock(stored = null) {
  const store = new Map();
  if (stored != null) {
    store.set(CHAT_FONT_SCALE_STORAGE_KEY, stored);
  }
  const root = { style: { zoom: "" } };
  globalThis.document = {
    documentElement: root,
    querySelectorAll: () => [],
  };
  globalThis.localStorage = {
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
  };
  return store;
}

afterEach(() => {
  globalThis.localStorage = originals.localStorage;
  globalThis.document = originals.document;
});

describe("chatFontScale", () => {
  it("clamps scale within supported bounds", () => {
    assert.equal(clampChatFontScale(0.5), 0.8);
    assert.equal(clampChatFontScale(2), 1.6);
    assert.equal(clampChatFontScale("1.23"), 1.2);
    assert.equal(clampChatFontScale("bad"), CHAT_FONT_SCALE_DEFAULT);
  });

  it("persists scale in localStorage", () => {
    const store = installStorageMock();
    storeChatFontScale(1.3);
    assert.equal(store.get(CHAT_FONT_SCALE_STORAGE_KEY), "1.3");
    assert.equal(readStoredChatFontScale(), 1.3);
  });

  it("adjusts scale in fixed steps", () => {
    assert.equal(adjustChatFontScale(1, 1), 1.1);
    assert.equal(adjustChatFontScale(0.8, -1), 0.8);
    assert.equal(adjustChatFontScale(1.6, 1), 1.6);
  });

  it("maps Cmd/Ctrl shortcuts to zoom actions", () => {
    assert.equal(chatFontScaleKeyAction({ metaKey: true, key: "=" }), "in");
    assert.equal(chatFontScaleKeyAction({ metaKey: true, key: "-" }), "out");
    assert.equal(chatFontScaleKeyAction({ metaKey: true, key: "0" }), "reset");
    assert.equal(chatFontScaleKeyAction({ key: "=" }), null);
    assert.equal(chatFontScaleKeyAction({ metaKey: true, altKey: true, key: "=" }), null);
  });

  it("applies zoom to a document root", () => {
    const root = { style: { zoom: "" } };
    applyChatFontScaleToDocument({ documentElement: root }, 1.2);
    assert.equal(root.style.zoom, "1.2");
  });

  it("applies zoom to the renderer shell and chat frames", () => {
    installStorageMock();
    const shellRoot = { style: { zoom: "" } };
    const frameRoot = { style: { zoom: "" } };
    globalThis.document = {
      documentElement: shellRoot,
      querySelectorAll: () => [{ contentDocument: { documentElement: frameRoot } }],
    };
    applyChatFontScale(1.3);
    assert.equal(shellRoot.style.zoom, "1.3");
    assert.equal(frameRoot.style.zoom, "1.3");
  });

  it("maps font scale actions to the next scale", () => {
    assert.equal(nextChatFontScaleFromAction(1, "in"), 1.1);
    assert.equal(nextChatFontScaleFromAction(1, "out"), 0.9);
    assert.equal(nextChatFontScaleFromAction(1.2, "reset"), CHAT_FONT_SCALE_DEFAULT);
  });
});
