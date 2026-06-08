import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  groupSessions,
  SIDEBAR_INITIAL_VISIBLE,
  SIDEBAR_LOAD_MORE_STEP,
  nextSidebarVisibleLimit,
  sliceForSidebarDisplay,
} from "../src/renderer/sidebarUtils.js";

describe("groupSessions", () => {
  it("orders by createdAt and ignores updatedAt changes", () => {
    const older = {
      id: "older",
      title: "Older",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-08T12:00:00.000Z",
    };
    const newer = {
      id: "newer",
      title: "Newer",
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-01T10:00:00.000Z",
    };
    assert.deepEqual(groupSessions([older, newer]).map((meta) => meta.id), ["newer", "older"]);
    assert.deepEqual(groupSessions([newer, older]).map((meta) => meta.id), ["newer", "older"]);
  });
});

describe("sliceForSidebarDisplay", () => {
  it("shows up to visibleLimit items", () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    assert.deepEqual(sliceForSidebarDisplay(items, 5), {
      visible: [1, 2, 3, 4, 5],
      hasMore: true,
    });
  });

  it("hasMore is false when all items fit", () => {
    const items = [1, 2, 3];
    assert.deepEqual(sliceForSidebarDisplay(items, 5), {
      visible: [1, 2, 3],
      hasMore: false,
    });
  });
});

describe("nextSidebarVisibleLimit", () => {
  it("adds load-more step", () => {
    assert.equal(
      nextSidebarVisibleLimit(SIDEBAR_INITIAL_VISIBLE),
      SIDEBAR_INITIAL_VISIBLE + SIDEBAR_LOAD_MORE_STEP
    );
  });
});
