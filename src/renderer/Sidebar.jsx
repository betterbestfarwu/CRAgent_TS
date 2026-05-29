import { useEffect, useMemo, useRef, useState } from "react";
import { displayTitle, filterSessions, groupSessions, relativeTime } from "./sidebarUtils.js";

const ICON_BUBBLE = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
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

const ICON_PLUS = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

function SessionRow({ meta, active, busy, forceActionButtons, onSelect, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const rowRef = useRef(null);
  const showActions = hovered || forceActionButtons;

  useEffect(() => {
    if (active) {
      rowRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [active, meta.id]);

  return (
    <div
      ref={rowRef}
      className={`session-row${active ? " active" : ""}${hovered && !active ? " hovered" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="session-row-surface">
        <button type="button" className="session-row-main" onClick={() => onSelect(meta.id)}>
          <span className="session-icon">
            {busy ? (
              <span className="session-spinner" aria-label="正在回复" />
            ) : (
              ICON_BUBBLE
            )}
          </span>
          <span className="session-title">{displayTitle(meta)}</span>
          {!showActions ? (
            <span className="session-time">{relativeTime(meta.createdAt)}</span>
          ) : null}
        </button>
        {showActions ? (
          <button
            type="button"
            className="session-delete"
            title="删除会话"
            aria-label="删除会话"
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
  open,
  sessions,
  currentSessionId,
  busyBySession = {},
  settingsActive,
  onSelect,
  onDelete,
  onNewChat,
}) {
  const [search, setSearch] = useState("");
  const [forceActionButtons, setForceActionButtons] = useState(false);

  const rows = useMemo(() => {
    const filtered = filterSessions(sessions, search);
    return groupSessions(filtered);
  }, [sessions, search]);

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setForceActionButtons(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
      <div className="sidebar-search-wrap">
        <span className="sidebar-search-icon">{ICON_SEARCH}</span>
        <input
          id="sidebar-search-input"
          className="sidebar-search"
          type="search"
          placeholder="Search chats"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="sidebar-actions">
        <button type="button" className="sidebar-action" title="新建会话" aria-label="新建会话" onClick={onNewChat}>
          <span className="sidebar-action-icon">{ICON_PLUS}</span>
          新建会话
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
              busy={Boolean(busyBySession[row.meta.id])}
              forceActionButtons={forceActionButtons}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          );
        })}
      </div>
    </aside>
  );
}
