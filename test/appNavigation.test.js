import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSessionBusyState,
  shouldAutoSwitchToChatPage,
} from "../src/renderer/appNavigation.js";

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

describe("getSessionBusyState", () => {
  it("does not carry another session's busy state into a newly selected session", () => {
    const busyBySession = new Map([["running-session", true]]);

    assert.equal(getSessionBusyState(busyBySession, "new-session"), false);
  });

  it("returns the selected session's busy state when it is known", () => {
    const busyBySession = new Map([["running-session", true]]);

    assert.equal(getSessionBusyState(busyBySession, "running-session"), true);
  });
});
