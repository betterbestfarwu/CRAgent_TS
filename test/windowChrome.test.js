import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveWindowChrome, WINDOW_CHROME } from "../src/shared/windowChrome.js";

describe("windowChrome", () => {
  it("uses light overlay colors by default", () => {
    const chrome = resolveWindowChrome("light");
    assert.equal(chrome.backgroundColor, "#f3f3f3");
    assert.equal(chrome.titleBarOverlay.color, "#f3f3f3");
    assert.equal(chrome.titleBarOverlay.symbolColor, "#141414");
  });

  it("uses dark overlay colors for dark mode", () => {
    const chrome = resolveWindowChrome("dark");
    assert.equal(chrome.backgroundColor, WINDOW_CHROME.dark.backgroundColor);
    assert.equal(chrome.titleBarOverlay.color, "#141414");
    assert.equal(chrome.titleBarOverlay.symbolColor, "#e4e4e4");
  });
});
