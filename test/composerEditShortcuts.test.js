import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composerEditShortcutAction } from "@shared/composerEditShortcuts.js";

describe("composerEditShortcutAction", () => {
  it("maps Cmd/Ctrl edit shortcuts", () => {
    assert.equal(composerEditShortcutAction({ metaKey: true, key: "a" }), "selectAll");
    assert.equal(composerEditShortcutAction({ metaKey: true, key: "A" }), "selectAll");
    assert.equal(composerEditShortcutAction({ ctrlKey: true, key: "c" }), "copy");
    assert.equal(composerEditShortcutAction({ metaKey: true, key: "x" }), "cut");
    assert.equal(composerEditShortcutAction({ metaKey: true, key: "v" }), "paste");
  });

  it("ignores shortcuts without a modifier or with alt", () => {
    assert.equal(composerEditShortcutAction({ key: "a" }), null);
    assert.equal(composerEditShortcutAction({ metaKey: true, altKey: true, key: "a" }), null);
    assert.equal(composerEditShortcutAction(null), null);
  });
});
