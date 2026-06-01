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
  return [...metas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function filterSessions(metas, query) {
  const q = query.trim().toLowerCase();
  if (!q) return metas;
  return metas.filter((meta) => displayTitle(meta).toLowerCase().includes(q));
}
