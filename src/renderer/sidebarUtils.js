import { isDefaultSessionTitle } from "@shared/sessionTitle";

export function displayTitle(meta) {
  const title = (meta.title || "").trim();
  if (!isDefaultSessionTitle(title)) {
    return title;
  }
  return title || "新会话";
}

export function groupSessions(metas) {
  if (!metas.length) return [];
  return [...metas].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function filterSessions(metas, query) {
  const q = query.trim().toLowerCase();
  if (!q) return metas;
  return metas.filter((meta) => displayTitle(meta).toLowerCase().includes(q));
}

export const SIDEBAR_INITIAL_VISIBLE = 5;
export const SIDEBAR_LOAD_MORE_STEP = 10;

/** @param {number} currentLimit */
export function nextSidebarVisibleLimit(currentLimit) {
  return currentLimit + SIDEBAR_LOAD_MORE_STEP;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} visibleLimit
 */
export function sliceForSidebarDisplay(items, visibleLimit) {
  const limit = Math.max(0, visibleLimit);
  return {
    visible: items.slice(0, limit),
    hasMore: items.length > limit,
  };
}
