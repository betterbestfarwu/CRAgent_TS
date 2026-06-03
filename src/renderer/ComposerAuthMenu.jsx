import { useEffect, useRef, useState } from "react";
import { AUTH_MODES, normalizeAuthMode } from "@shared/authMode.js";

export function ComposerMenuCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ComposerAuthMenu({ authMode, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const current = AUTH_MODES[normalizeAuthMode(authMode)];

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
    <div className={`composer-auth-wrap composer-auth-wrap--${current.id}`} ref={wrapRef}>
      <button
        type="button"
        className={`composer-auth-btn${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current.description}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="composer-auth-label">{current.label}</span>
        <span className="composer-auth-chevron" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="composer-auth-menu" role="menu">
          {Object.values(AUTH_MODES).map((mode) => {
            const selected = mode.id === current.id;
            return (
              <button
                key={mode.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                title={mode.description}
                className={`composer-auth-item${selected ? " active" : ""}`}
                onClick={() => {
                  onChange(mode.id);
                  setOpen(false);
                }}
              >
                <span className="composer-auth-item-label">{mode.label}</span>
                <span className="composer-auth-item-check">
                  {selected ? <ComposerMenuCheckIcon /> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
