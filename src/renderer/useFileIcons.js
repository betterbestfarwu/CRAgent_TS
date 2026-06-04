import { useEffect, useMemo, useState } from "react";

const iconCache = new Map();

function buildIconsState(paths) {
  const next = {};
  for (const path of paths) {
    const clean = path?.trim();
    if (clean && iconCache.has(clean)) {
      next[clean] = iconCache.get(clean);
    }
  }
  return next;
}

export function useFileIcons(paths) {
  const normalizedPaths = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const path of paths) {
      const clean = String(path ?? "").trim();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      list.push(clean);
    }
    return list;
  }, [paths]);

  const pathsKey = normalizedPaths.join("|");
  const [icons, setIcons] = useState(() => buildIconsState(normalizedPaths));

  useEffect(() => {
    setIcons(buildIconsState(normalizedPaths));

    const getFileIcons = window.cragent?.getFileIcons;
    if (typeof getFileIcons !== "function") return undefined;

    const missing = normalizedPaths.filter((path) => !iconCache.has(path));
    if (!missing.length) return undefined;

    let cancelled = false;
    void getFileIcons(missing).then((result) => {
      if (cancelled) return;
      for (const [path, url] of Object.entries(result || {})) {
        if (url) iconCache.set(path, url);
      }
      setIcons(buildIconsState(normalizedPaths));
    });

    return () => {
      cancelled = true;
    };
  }, [pathsKey, normalizedPaths]);

  return icons;
}
