import { useEffect, useMemo, useRef, useState } from "react";
import { displayTitle, filterSessions, groupSessions } from "./sidebarUtils.js";

const ICON_BUBBLE = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
    <path d="M7.25 9.75C7.94036 9.75 8.5 10.3096 8.5 11C8.5 11.6904 7.94036 12.25 7.25 12.25C6.55964 12.25 6 11.6904 6 11C6 10.3096 6.55964 9.75 7.25 9.75Z" />
    <path d="M12 9.75C12.6904 9.75 13.25 10.3096 13.25 11C13.25 11.6904 12.6904 12.25 12 12.25C11.3096 12.25 10.75 11.6904 10.75 11C10.75 10.3096 11.3096 9.75 12 9.75Z" />
    <path d="M16.75 9.75C17.4404 9.75 18 10.3096 18 11C18 11.6904 17.4404 12.25 16.75 12.25C16.0596 12.25 15.5 11.6904 15.5 11C15.5 10.3096 16.0596 9.75 16.75 9.75Z" />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 1.73633C14.1692 1.73633 16.1557 1.89992 17.7285 2.08887C19.9229 2.35249 21.6506 3.98709 21.958 6.17578C22.1467 7.51917 22.2998 9.15932 22.2998 10.9365C22.2998 12.7137 22.1467 14.3539 21.958 15.6973C21.6505 17.8858 19.9228 19.5206 17.7285 19.7842C16.1557 19.9731 14.1692 20.1367 12 20.1367C11.9668 20.1367 11.9335 20.1358 11.9004 20.1357L6.76465 23.0117C6.04212 23.4163 5.16911 22.8178 5.28613 21.998L5.61914 19.6621C3.74132 19.1829 2.31832 17.6639 2.04199 15.6973C1.8533 14.3539 1.70021 12.7137 1.7002 10.9365C1.7002 9.15932 1.8533 7.51917 2.04199 6.17578C2.34942 3.98709 4.07709 2.35249 6.27148 2.08887C7.84432 1.89992 9.83077 1.73633 12 1.73633ZM12 3.33594C9.90868 3.33594 7.98719 3.4945 6.46191 3.67773C4.96094 3.85824 3.82865 4.95557 3.62598 6.39844C3.46792 7.52375 3.33698 8.86201 3.30664 10.3096L3.2998 10.9365C3.29982 12.6242 3.44534 14.1885 3.62598 15.4746C3.80878 16.7756 4.7432 17.7868 6.01465 18.1113L7.40527 18.4668L7.04102 21.0215L11.1182 18.7393L11.4844 18.5352L11.9043 18.5361C11.9321 18.5362 11.9586 18.5359 11.9727 18.5361C11.9902 18.5364 11.9962 18.5371 12 18.5371C14.0913 18.5371 16.0128 18.3785 17.5381 18.1953C19.0389 18.0148 20.1713 16.9175 20.374 15.4746C20.5321 14.3493 20.663 13.011 20.6934 11.5635L20.7002 10.9365C20.7002 9.24882 20.5547 7.68455 20.374 6.39844C20.1714 4.95557 19.0391 3.85824 17.5381 3.67773C16.2034 3.51739 14.5651 3.37646 12.7754 3.34375L12 3.33594Z"
    />
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

const ICON_FOLDER = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </svg>
);

const ICON_CARET_RIGHT = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M6 4.5 10.5 8 6 11.5V4.5Z" />
  </svg>
);

const ICON_CARET_DOWN = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M4.5 6 8 10.5 11.5 6H4.5Z" />
  </svg>
);

function ProjectNodeHead({ project, expanded, active, onSelect, onNewChat }) {
  const [hovered, setHovered] = useState(false);
  const showAddBtn = hovered;

  return (
    <div
      className={`project-node-head${active ? " active" : ""}${hovered && !expanded ? " hovered" : ""}`}
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
            {expanded ? ICON_CARET_DOWN : hovered ? ICON_CARET_RIGHT : ICON_FOLDER}
          </span>
          <span className="project-node-name">{project.name}</span>
        </button>
        {showAddBtn ? (
          <button
            type="button"
            className="project-node-add-chat"
            title="在此项目新建会话"
            aria-label="在此项目新建会话"
            onClick={() => onNewChat?.(project.id)}
          >
            {ICON_PLUS}
          </button>
        ) : null}
      </div>
    </div>
  );
}

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
  selectedProjectId = null,
  sessions,
  currentSessionId,
  busyBySession = {},
  settingsActive,
  onSelect,
  onDelete,
  onNewChat,
  onSelectProject,
  onAddProject,
  onAddProjectByPath,
  onNewProjectChat,
}) {
  const [search, setSearch] = useState("");
  const [forceActionButtons, setForceActionButtons] = useState(false);
  const [projectDropActive, setProjectDropActive] = useState(false);

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
          {fixedRows.map((meta) => (
            <SessionRow
              key={meta.id}
              meta={meta}
              active={!settingsActive && meta.id === currentSessionId}
              busy={Boolean(busyBySession[meta.id])}
              forceActionButtons={forceActionButtons}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
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
              {ICON_PLUS}
            </button>
          </div>
          <div className="project-node-list">
          {projects.map((project) => {
            const rows = projectRows.get(project.id) || [];
            const expanded = selectedProjectId === project.id;
            const hasActiveChild =
              !settingsActive && rows.some((meta) => meta.id === currentSessionId);
            return (
              <div key={project.id} className="project-node">
                <ProjectNodeHead
                  project={project}
                  expanded={expanded}
                  active={expanded && !hasActiveChild}
                  onSelect={onSelectProject}
                  onNewChat={onNewProjectChat}
                />
                {expanded ? (
                  <div className="project-node-content">
                    {rows.map((meta) => (
                      <SessionRow
                        key={meta.id}
                        meta={meta}
                        active={!settingsActive && meta.id === currentSessionId}
                        busy={Boolean(busyBySession[meta.id])}
                        forceActionButtons={forceActionButtons}
                        onSelect={onSelect}
                        onDelete={onDelete}
                      />
                    ))}
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
