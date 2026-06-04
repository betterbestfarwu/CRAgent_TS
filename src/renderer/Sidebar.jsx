import { useEffect, useMemo, useRef, useState } from "react";
import {
  displayTitle,
  filterSessions,
  groupSessions,
  nextSidebarVisibleLimit,
  SIDEBAR_INITIAL_VISIBLE,
  sliceForSidebarDisplay,
} from "./sidebarUtils.js";

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
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </svg>
);

const ICON_MORE = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
  </svg>
);

const ICON_MENU_FOLDER = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <path d="M3 7h5l2 2h11v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
);

const ICON_MENU_REMOVE = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ICON_CARET_RIGHT = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M6 4.5 10.5 8 6 11.5V4.5Z" />
  </svg>
);

const ICON_CARET_DOWN = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M4.5 6 8 10.5 11.5 6H4.5Z" />
  </svg>
);

const CURSOR_OUTLINE_ICON = {
  folder: "\uEA83",
  "folder-open": "\uEAF7",
  "folder-plus": "\uEA80",
};

function SessionStatusDot({ active, busy, unread }) {
  if (busy) {
    return <span className="session-spinner" aria-label="正在回复" />;
  }

  const showUnread = unread && !active;
  return (
    <span
      className={`session-status-dot${showUnread ? " session-status-dot--unread" : ""}`}
      aria-hidden="true"
    />
  );
}

function CursorOutlineIcon({ name, size = 14 }) {
  const glyph = CURSOR_OUTLINE_ICON[name];
  if (!glyph) return null;
  return (
    <i
      className="cursor-icon ui-icon"
      style={{
        "--cursor-icon-content": `"${glyph}"`,
        "--icon-size": `${size}px`,
      }}
      aria-hidden="true"
    />
  );
}

function ProjectNodeMenu({ project, onRemove, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event) => {
      if (!wrapRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="project-node-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`project-node-menu-btn${open ? " is-open" : ""}`}
        title="更多操作"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        {ICON_MORE}
      </button>
      {open ? (
        <div className="project-node-menu" role="menu">
          <button
            type="button"
            className="project-node-menu-item"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              void window.cragent?.openProjectDirectory?.(project.id);
            }}
          >
            <span className="project-node-menu-item-icon">{ICON_MENU_FOLDER}</span>
            <span className="project-node-menu-item-label">在 Finder 中显示</span>
          </button>
          <button
            type="button"
            className="project-node-menu-item"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRemove?.(project);
            }}
          >
            <span className="project-node-menu-item-icon">{ICON_MENU_REMOVE}</span>
            <span className="project-node-menu-item-label">删除</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProjectNodeHead({ project, expanded, forceActionButtons, onSelect, onNewChat, onRemove }) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showActions = hovered || forceActionButtons || menuOpen;

  return (
    <div
      className={`project-node-head${hovered ? " hovered" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="project-node-surface">
        <button
          type="button"
          className="project-node-main"
          title={project.directoryPath}
          onClick={() => onSelect?.(project.id)}
        >
          <span className="project-node-icon">
            {hovered ? (
              expanded ? ICON_CARET_DOWN : ICON_CARET_RIGHT
            ) : (
              <CursorOutlineIcon name={expanded ? "folder-open" : "folder"} />
            )}
          </span>
          <span className="project-node-name">{project.name}</span>
        </button>
        {showActions ? (
          <>
            <ProjectNodeMenu
              project={project}
              onRemove={onRemove}
              onOpenChange={setMenuOpen}
            />
            <button
              type="button"
              className="project-node-add-chat"
              title="在此项目新建会话"
              aria-label="在此项目新建会话"
              onClick={(e) => {
                e.stopPropagation();
                onNewChat?.(project.id);
              }}
            >
              {ICON_PLUS}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SeeMoreRow({ onClick }) {
  return (
    <button type="button" className="sidebar-see-more" onClick={onClick}>
      See more
    </button>
  );
}

function ProjectEmptyState() {
  return (
    <div className="project-node-empty" aria-hidden="true">
      No agents yet
    </div>
  );
}

function SessionRow({ meta, active, busy, unread, forceActionButtons, onSelect, onDelete }) {
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
            <SessionStatusDot active={active} busy={busy} unread={unread} />
          </span>
          <span className="session-title">{displayTitle(meta)}</span>
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
  projects = [],
  expandedProjectIds = [],
  sessions,
  currentSessionId,
  busyBySession = {},
  unreadBySession = {},
  settingsActive,
  onSelect,
  onDelete,
  onNewChat,
  onSelectProject,
  onAddProject,
  onAddProjectByPath,
  onNewProjectChat,
  onRemoveProject,
}) {
  const [search, setSearch] = useState("");
  const [forceActionButtons, setForceActionButtons] = useState(false);
  const [projectDropActive, setProjectDropActive] = useState(false);
  const [sessionsVisibleLimit, setSessionsVisibleLimit] = useState(SIDEBAR_INITIAL_VISIBLE);
  const [projectSessionsVisibleLimits, setProjectSessionsVisibleLimits] = useState(
    () => new Map()
  );

  const filteredSessions = useMemo(() => {
    const filtered = filterSessions(sessions, search);
    return filtered;
  }, [sessions, search]);

  const fixedRows = useMemo(() => {
    const fixed = filteredSessions.filter((meta) => !meta.projectId);
    return groupSessions(fixed);
  }, [filteredSessions]);

  const projectRows = useMemo(() => {
    const byProject = new Map();
    for (const meta of filteredSessions) {
      if (!meta.projectId) continue;
      const list = byProject.get(meta.projectId) || [];
      list.push(meta);
      byProject.set(meta.projectId, list);
    }
    const rowsByProject = new Map();
    for (const project of projects) {
      rowsByProject.set(project.id, groupSessions(byProject.get(project.id) || []));
    }
    return rowsByProject;
  }, [filteredSessions, projects]);

  function extractDroppedPath(dataTransfer) {
    const files = Array.from(dataTransfer?.files || []);
    const first = files[0];
    if (!first) return "";
    if (first.webkitRelativePath) {
      const segments = first.webkitRelativePath.split("/").filter(Boolean);
      let path = first.path || "";
      const trimCount = Math.max(1, segments.length - 1);
      for (let i = 0; i < trimCount; i += 1) {
        path = path.replace(/[/\\][^/\\]+$/, "");
      }
      return path;
    }
    return first.path || "";
  }

  const sessionsDisplay = useMemo(
    () => sliceForSidebarDisplay(fixedRows, sessionsVisibleLimit),
    [fixedRows, sessionsVisibleLimit]
  );

  useEffect(() => {
    setSessionsVisibleLimit(SIDEBAR_INITIAL_VISIBLE);
    setProjectSessionsVisibleLimits(new Map());
  }, [search]);

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
        <button
          type="button"
          className="session-root-label"
          title="切换到临时会话分组"
          onClick={() => onSelectProject?.(null)}
        >
          会话
        </button>
        <div className="session-node-content">
          {sessionsDisplay.visible.map((meta) => (
            <SessionRow
              key={meta.id}
              meta={meta}
              active={!settingsActive && meta.id === currentSessionId}
              busy={Boolean(busyBySession[meta.id])}
              unread={Boolean(unreadBySession[meta.id])}
              forceActionButtons={forceActionButtons}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
          {sessionsDisplay.hasMore ? (
            <SeeMoreRow
              onClick={() =>
                setSessionsVisibleLimit((limit) => nextSidebarVisibleLimit(limit))
              }
            />
          ) : null}
        </div>
        <div
          className={`project-section${projectDropActive ? " drag-over" : ""}`}
          onDragEnter={(event) => {
            if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
            event.preventDefault();
            setProjectDropActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setProjectDropActive(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return;
            setProjectDropActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setProjectDropActive(false);
            const directoryPath = extractDroppedPath(event.dataTransfer);
            if (!directoryPath) return;
            onAddProjectByPath?.(directoryPath);
          }}
        >
          <div className="project-header-row">
            <div className="session-group-header project-group-header">项目</div>
            <button
              type="button"
              className="project-add-btn"
              title="添加项目目录"
              aria-label="添加项目目录"
              onClick={onAddProject}
            >
              <CursorOutlineIcon name="folder-plus" />
            </button>
          </div>
          <div className="project-node-list">
          {projects.map((project) => {
            const rows = projectRows.get(project.id) || [];
            const expanded = expandedProjectIds.includes(project.id);
            const projectSessionsLimit =
              projectSessionsVisibleLimits.get(project.id) ?? SIDEBAR_INITIAL_VISIBLE;
            const projectSessionsDisplay = sliceForSidebarDisplay(rows, projectSessionsLimit);
            return (
              <div key={project.id} className="project-node">
                <ProjectNodeHead
                  project={project}
                  expanded={expanded}
                  forceActionButtons={forceActionButtons}
                  onSelect={onSelectProject}
                  onNewChat={onNewProjectChat}
                  onRemove={onRemoveProject}
                />
                {expanded ? (
                  <div className="project-node-content">
                    {rows.length === 0 ? (
                      <ProjectEmptyState />
                    ) : (
                      projectSessionsDisplay.visible.map((meta) => (
                        <SessionRow
                          key={meta.id}
                          meta={meta}
                          active={!settingsActive && meta.id === currentSessionId}
                          busy={Boolean(busyBySession[meta.id])}
                          unread={Boolean(unreadBySession[meta.id])}
                          forceActionButtons={forceActionButtons}
                          onSelect={onSelect}
                          onDelete={onDelete}
                        />
                      ))
                    )}
                    {rows.length > 0 && projectSessionsDisplay.hasMore ? (
                      <SeeMoreRow
                        onClick={() =>
                          setProjectSessionsVisibleLimits((prev) => {
                            const next = new Map(prev);
                            const current = next.get(project.id) ?? SIDEBAR_INITIAL_VISIBLE;
                            next.set(project.id, nextSidebarVisibleLimit(current));
                            return next;
                          })
                        }
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </aside>
  );
}
