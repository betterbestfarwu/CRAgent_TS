const ICON_PANEL_LEFT = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
  </svg>
);

const ICON_SEARCH = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" />
  </svg>
);

const ICON_PLUS = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const ICON_SETTINGS = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

const ICON_LAPTOP = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M1 20h22" />
  </svg>
);

export function TitleBar({
  title,
  settingsActive,
  onToggleSidebar,
  onFocusSearch,
  onNewChat,
  onOpenSettings,
}) {
  if (!window.cragent?.isDesktop) {
    return null;
  }

  const platform = window.cragent.platform || "";
  const platformClass =
    platform === "darwin" ? "titlebar--darwin" : platform === "win32" ? "titlebar--win32" : "titlebar--linux";

  return (
    <header className={`titlebar ${platformClass}`}>
      <div className="titlebar-drag-region" aria-hidden="true" />
      <div className="titlebar-inner">
        <div className="titlebar-leading">
          <button
            type="button"
            className="titlebar-icon-btn"
            title="切换侧栏"
            aria-label="切换侧栏"
            onClick={onToggleSidebar}
          >
            {ICON_PANEL_LEFT}
          </button>
          <button
            type="button"
            className="titlebar-icon-btn"
            title="搜索会话"
            aria-label="搜索会话"
            onClick={onFocusSearch}
          >
            {ICON_SEARCH}
          </button>
        </div>

        <div className="titlebar-center">
          <div className="titlebar-pill" title={title}>
            <span className="titlebar-pill-text">{title}</span>
            <span className="titlebar-pill-icon">{ICON_LAPTOP}</span>
          </div>
        </div>

        <div className="titlebar-trailing">
          <button
            type="button"
            className="titlebar-icon-btn"
            title="新建会话"
            aria-label="新建会话"
            onClick={onNewChat}
          >
            {ICON_PLUS}
          </button>
          <button
            type="button"
            className={`titlebar-icon-btn${settingsActive ? " active" : ""}`}
            title="设置"
            aria-label="设置"
            onClick={onOpenSettings}
          >
            {ICON_SETTINGS}
          </button>
        </div>
      </div>
    </header>
  );
}
