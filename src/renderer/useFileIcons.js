import { useEffect, useMemo, useState } from "react";

const iconCache = new Map();

function buildIconsState(files) {
  const next = {};
  for (const file of files) {
    const path = file.path?.trim();
    if (path && iconCache.has(path)) {
      next[path] = iconCache.get(path);
    }
  }
  return next;
}

export function useFileIcons(files) {
  const filesKey = useMemo(
    () => files.map((file) => `${file.id}:${file.path || ""}`).join("|"),
    [files],
  );
  const [icons, setIcons] = useState(() => buildIconsState(files));

  useEffect(() => {
    setIcons(buildIconsState(files));

    const getFileIcons = window.cragent?.getFileIcons;
    if (typeof getFileIcons !== "function") return undefined;

    const paths = files
      .map((file) => file.path?.trim())
      .filter(Boolean)
      .filter((path) => !iconCache.has(path));
    if (!paths.length) return undefined;

    let cancelled = false;
    void getFileIcons(paths).then((result) => {
      if (cancelled) return;
      for (const [path, url] of Object.entries(result || {})) {
        if (url) iconCache.set(path, url);
      }
      setIcons(buildIconsState(files));
    });

    return () => {
      cancelled = true;
    };
  }, [filesKey]);

  return icons;
}
