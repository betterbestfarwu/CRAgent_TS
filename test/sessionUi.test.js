import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sessionHasActiveSurface,
  sessionShowsLoadOlder,
} from "../src/renderer/sessionUi.js";

describe("sessionShowsLoadOlder", () => {
  it("hides the control when all messages are loaded", () => {
    assert.equal(
      sessionShowsLoadOlder({
        meta: { messageCount: 2, hasMoreMessages: true },
        messages: [{ id: "m1" }, { id: "m2" }],
      }),
      false,
    );
  });

  it("shows the control when older messages remain", () => {
    assert.equal(
      sessionShowsLoadOlder({
        meta: { messageCount: 120, hasMoreMessages: true },
        messages: Array.from({ length: 100 }, (_v, index) => ({ id: `m${index}` })),
      }),
      true,
    );
  });
});

describe("sessionHasActiveSurface", () => {
  it("treats a busy empty session as active while the first message is being sent", () => {
    assert.equal(
      sessionHasActiveSurface({
        session: {
          meta: { id: "s1" },
          messages: [],
        },
        busy: true,
      }),
      true,
    );
  });
});
