import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SIDEBAR_INITIAL_VISIBLE,
  SIDEBAR_LOAD_MORE_STEP,
  nextSidebarVisibleLimit,
  sliceForSidebarDisplay,
} from "../src/renderer/sidebarUtils.js";

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
