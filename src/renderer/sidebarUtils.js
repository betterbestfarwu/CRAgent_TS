const BUCKET_LABELS = ["今天", "昨天", "本周", "更早"];

export function relativeTime(isoDate) {
  const date = new Date(isoDate);
  const secs = (Date.now() - date.getTime()) / 1000;
  if (secs < 60) return "刚刚";
  if (secs < 3600) return `${Math.floor(secs / 60)}分钟`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}小时`;
  if (secs < 86400 * 7) return `${Math.floor(secs / 86400)}天`;
  if (secs < 86400 * 30) return `${Math.floor(secs / (86400 * 7))}周`;
  return `${Math.floor(secs / (86400 * 30))}月`;
}

export function displayTitle(meta) {
  const title = (meta.title || "").trim();
  if (title && title !== "新对话" && title !== "New Chat") {
    return title;
  }
  return title || "新对话";
}

function bucketFor(date, now = new Date()) {
  const cal = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const startOfToday = cal(now);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  const d = new Date(date);
  if (d >= startOfToday) return 0;
  if (d >= startOfYesterday) return 1;
  if (d >= startOfWeek) return 2;
  return 3;
}

/** @returns {Array<{ kind: 'header', label: string } | { kind: 'session', meta: object }>} */
export function groupSessions(metas) {
  if (!metas.length) return [];
  const sorted = [...metas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const rows = [];
  let lastBucket = -1;
  for (const meta of sorted) {
    const b = bucketFor(meta.createdAt);
    if (b !== lastBucket) {
      rows.push({ kind: "header", label: BUCKET_LABELS[b] });
      lastBucket = b;
    }
    rows.push({ kind: "session", meta });
  }
  return rows;
}

export function filterSessions(metas, query) {
  const q = query.trim().toLowerCase();
  if (!q) return metas;
  return metas.filter((meta) => displayTitle(meta).toLowerCase().includes(q));
}
