import { useMemo, useState } from "react";
import { displayTitle, filterSessions, groupSessions, relativeTime } from "./sidebarUtils.js";

const ICON_BUBBLE = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

const ICON_TRASH = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const ICON_SEARCH = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" />
  </svg>
);

function SessionRow({ meta, active, onSelect, onDelete }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`session-row${active ? " active" : ""}${hovered && !active ? " hovered" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="session-row-surface">
        <button type="button" className="session-row-main" onClick={() => onSelect(meta.id)}>
          <span className="session-icon">{ICON_BUBBLE}</span>
          <span className="session-title">{displayTitle(meta)}</span>
          {!hovered ? (
            <span className="session-time">{relativeTime(meta.createdAt)}</span>
          ) : null}
        </button>
        {hovered ? (
          <button
            type="button"
            className="session-delete"
            title="Delete chat"
            aria-label="Delete chat"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(meta);
            }}
          >
            {ICON_TRASH}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Sidebar({
  sessions,
  currentSessionId,
  settingsActive,
  onSelect,
  onDelete,
  onNewChat,
  onOpenSettings,
}) {
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const filtered = filterSessions(sessions, search);
    return groupSessions(filtered);
  }, [sessions, search]);

  return (
    <aside className="sidebar">
      <div className="sidebar-search-wrap">
        <span className="sidebar-search-icon">{ICON_SEARCH}</span>
        <input
          className="sidebar-search"
          type="search"
          placeholder="Search chats"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="sidebar-actions">
        <button type="button" className="sidebar-action" onClick={onNewChat}>
          + 新建会话
        </button>
        <button
          type="button"
          className={`sidebar-action${settingsActive ? " active" : ""}`}
          onClick={onOpenSettings}
        >
          设置
        </button>
      </div>
      <div className="session-list">
        {rows.map((row, index) => {
          if (row.kind === "header") {
            return (
              <div key={`h-${row.label}-${index}`} className="session-group-header">
                {row.label}
              </div>
            );
          }
          return (
            <SessionRow
              key={row.meta.id}
              meta={row.meta}
              active={!settingsActive && row.meta.id === currentSessionId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          );
        })}
      </div>
    </aside>
  );
}
