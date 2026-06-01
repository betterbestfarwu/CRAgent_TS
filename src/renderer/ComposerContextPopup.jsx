import { useEffect, useRef } from "react";
import { formatTokens } from "@shared/tokenEstimator.js";

export function ComposerContextPopup({ open, usage, anchorRef, onClose }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event) => {
      const anchor = anchorRef?.current;
      if (
        panelRef.current?.contains(event.target) ||
        anchor?.contains(event.target)
      ) {
        return;
      }
      onClose?.();
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, anchorRef, onClose]);

  if (!open || !usage) {
    return null;
  }

  const { percent, tokens, contextWindow, categories = [] } = usage;
  const barTotal = contextWindow || tokens || 1;

  return (
    <div className="composer-context-popup" ref={panelRef} role="dialog" aria-label="Context">
      <div className="composer-context-popup-header">
        <span className="composer-context-popup-title">Context</span>
        <button
          type="button"
          className="composer-context-popup-close"
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="composer-context-popup-summary">
        <span>{percent}% Full</span>
        <span>
          ~{formatTokens(tokens)} / {formatTokens(contextWindow)} Tokens
        </span>
      </div>

      <div className="composer-context-popup-bar" aria-hidden="true">
        {categories.map((category) => (
          <span
            key={category.id}
            className="composer-context-popup-bar-segment"
            style={{
              width: `${Math.max(0, (category.tokens / barTotal) * 100)}%`,
              backgroundColor: category.color,
            }}
          />
        ))}
      </div>

      <ul className="composer-context-popup-list">
        {categories.map((category) => (
          <li key={category.id} className="composer-context-popup-row">
            <span className="composer-context-popup-row-left">
              <span
                className="composer-context-popup-swatch"
                style={{ backgroundColor: category.color }}
                aria-hidden="true"
              />
              <span>{category.label}</span>
            </span>
            <span className="composer-context-popup-row-value">{formatTokens(category.tokens)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
