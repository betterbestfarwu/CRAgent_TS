import { useEffect, useMemo, useRef, useState } from "react";

const ICON_FOLDER = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <path d="M3 7h5l2 2h11v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
);

const ICON_FOLDER_PLUS = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <path d="M3 7h5l2 2h11v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    <line x1="12" y1="11" x2="12" y2="15" />
    <line x1="10" y1="13" x2="14" y2="13" />
  </svg>
);

const ICON_FOLDER_X = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <path d="M3 7h5l2 2h11v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    <line x1="9.5" y1="12" x2="14.5" y2="12" />
  </svg>
);

const ICON_SEARCH = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" />
  </svg>
);

const ICON_CHEVRON_DOWN = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ICON_CHEVRON_RIGHT = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

const ICON_CHECK = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export function ComposerProjectPicker({
  projects,
  selectedProjectId,
  displayLabel,
  onSelectProject,
  onAddProject,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) => {
      const name = String(project.name || "").toLowerCase();
      const path = String(project.directoryPath || "").toLowerCase();
      return name.includes(needle) || path.includes(needle);
    });
  }, [projects, query]);

  const menuItems = useMemo(() => {
    const items = filteredProjects.map((project) => ({
      kind: "project",
      project,
    }));
    items.push({ kind: "add" }, { kind: "none" });
    return items;
  }, [filteredProjects]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlightIndex(0);
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (highlightIndex >= menuItems.length) {
      setHighlightIndex(Math.max(0, menuItems.length - 1));
    }
  }, [highlightIndex, menuItems.length]);

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

  function activateItem(item) {
    if (!item) return;
    if (item.kind === "project") {
      onSelectProject?.(item.project.id);
      setOpen(false);
      return;
    }
    if (item.kind === "add") {
      setOpen(false);
      void onAddProject?.();
      return;
    }
    if (item.kind === "none") {
      onSelectProject?.(null);
      setOpen(false);
    }
  }

  function handleTriggerKeyDown(event) {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
    }
  }

  function handleSearchKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, menuItems.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activateItem(menuItems[highlightIndex]);
    }
  }

  return (
    <div className={`composer-project-picker${open ? " is-open" : ""}`} ref={wrapRef}>
      {open ? (
        <div className="composer-project-menu" role="dialog" aria-label="选择项目">
          <div className="composer-project-menu-search">
            <span className="composer-project-menu-search-icon" aria-hidden="true">
              {ICON_SEARCH}
            </span>
            <input
              ref={searchRef}
              type="search"
              className="composer-project-menu-search-input"
              placeholder="搜索项目"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              aria-label="搜索项目"
            />
          </div>
          <div className="composer-project-menu-list" role="listbox" aria-label="项目列表">
            {filteredProjects.length ? (
              filteredProjects.map((project, index) => {
                const selected = project.id === selectedProjectId;
                const highlighted = menuItems[highlightIndex]?.kind === "project" &&
                  menuItems[highlightIndex]?.project?.id === project.id;
                return (
                  <button
                    key={project.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`composer-project-menu-item${highlighted ? " highlighted" : ""}`}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => activateItem({ kind: "project", project })}
                  >
                    <span className="composer-project-menu-item-icon" aria-hidden="true">
                      {ICON_FOLDER}
                    </span>
                    <span className="composer-project-menu-item-label">{project.name}</span>
                    {selected ? (
                      <span className="composer-project-menu-item-check" aria-hidden="true">
                        {ICON_CHECK}
                      </span>
                    ) : null}
                  </button>
                );
              })
            ) : (
              <div className="composer-project-menu-empty">未找到匹配的项目</div>
            )}
          </div>
          <div className="composer-project-menu-divider" role="separator" aria-hidden="true" />
          <button
            type="button"
            className={`composer-project-menu-item composer-project-menu-item-action${
              menuItems[highlightIndex]?.kind === "add" ? " highlighted" : ""
            }`}
            onMouseEnter={() => setHighlightIndex(filteredProjects.length)}
            onClick={() => activateItem({ kind: "add" })}
          >
            <span className="composer-project-menu-item-icon" aria-hidden="true">
              {ICON_FOLDER_PLUS}
            </span>
            <span className="composer-project-menu-item-label">添加新项目</span>
            <span className="composer-project-menu-item-trail" aria-hidden="true">
              {ICON_CHEVRON_RIGHT}
            </span>
          </button>
          <button
            type="button"
            className={`composer-project-menu-item composer-project-menu-item-action${
              menuItems[highlightIndex]?.kind === "none" ? " highlighted" : ""
            }`}
            onMouseEnter={() => setHighlightIndex(filteredProjects.length + 1)}
            onClick={() => activateItem({ kind: "none" })}
          >
            <span className="composer-project-menu-item-icon" aria-hidden="true">
              {ICON_FOLDER_X}
            </span>
            <span className="composer-project-menu-item-label">不使用项目</span>
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="composer-project-bar"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="composer-project-bar-icon" aria-hidden="true">
          {ICON_FOLDER}
        </span>
        <span className="composer-project-bar-label">{displayLabel}</span>
        <span className="composer-project-bar-chevron" aria-hidden="true">
          {ICON_CHEVRON_DOWN}
        </span>
      </button>
    </div>
  );
}
