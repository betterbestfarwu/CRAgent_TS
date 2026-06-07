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

const ICON_SETTINGS = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831 2.34 2.34 0 0 1 2.33-4.033 2.34 2.34 0 0 0 3.319-1.915" />
  </svg>
);

const ICON_LAPTOP = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M1 20h22" />
  </svg>
);

const ICON_MOON = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <path
      d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ICON_SUN = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
  </svg>
);

export function TitleBar({
  title,
  colorScheme,
  settingsActive,
  onToggleSidebar,
  onFocusSearch,
  onToggleColorScheme,
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
            title={colorScheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            aria-label={colorScheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            onClick={onToggleColorScheme}
          >
            {colorScheme === "dark" ? ICON_SUN : ICON_MOON}
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
