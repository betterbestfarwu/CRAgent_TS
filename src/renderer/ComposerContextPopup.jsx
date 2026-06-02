import { useEffect, useRef, useState } from "react";
import { formatTokens } from "@shared/tokenEstimator.js";

const EMPTY_PREVIEW = "(无内容)";

export function ComposerContextPopup({ open, usage, anchorRef, onClose }) {
  const panelRef = useRef(null);
  const [expandedCategoryId, setExpandedCategoryId] = useState(null);

  useEffect(() => {
    if (!open) {
      setExpandedCategoryId(null);
    }
  }, [open]);

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

  const toggleCategory = (categoryId) => {
    setExpandedCategoryId((prev) => (prev === categoryId ? null : categoryId));
  };

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
        {categories.map((category) => {
          const expanded = expandedCategoryId === category.id;
          const previewText = category.previewText?.trim() || EMPTY_PREVIEW;
          return (
            <li key={category.id} className="composer-context-popup-item">
              <button
                type="button"
                className={`composer-context-popup-row composer-context-popup-row--expandable${
                  expanded ? " composer-context-popup-row--expanded" : ""
                }`}
                onClick={() => toggleCategory(category.id)}
                aria-expanded={expanded}
              >
                <span className="composer-context-popup-row-left">
                  <span
                    className="composer-context-popup-swatch"
                    style={{ backgroundColor: category.color }}
                    aria-hidden="true"
                  />
                  <span>{category.label}</span>
                  <span className="composer-context-popup-expand" aria-hidden="true">
                    {expanded ? "▾" : "▸"}
                  </span>
                </span>
                <span className="composer-context-popup-row-value">
                  {formatTokens(category.tokens)}
                </span>
              </button>
              {expanded ? (
                <pre className="composer-context-popup-preview">{previewText}</pre>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
