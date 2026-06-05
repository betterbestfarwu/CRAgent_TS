import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldAutoSwitchToChatPage } from "../src/renderer/appNavigation.js";

describe("shouldAutoSwitchToChatPage", () => {
  it("keeps the settings page open for assistant replies and session metadata refreshes", () => {
    assert.equal(shouldAutoSwitchToChatPage("settings", true), false);
  });

  it("keeps future non-chat pages open for background session updates", () => {
    assert.equal(shouldAutoSwitchToChatPage("projects", true), false);
  });

  it("allows the current chat page to stay on chat when the current session updates", () => {
    assert.equal(shouldAutoSwitchToChatPage("chat", true), true);
  });

  it("ignores session updates that are not being viewed", () => {
    assert.equal(shouldAutoSwitchToChatPage("chat", false), false);
    assert.equal(shouldAutoSwitchToChatPage("settings", false), false);
  });
});
