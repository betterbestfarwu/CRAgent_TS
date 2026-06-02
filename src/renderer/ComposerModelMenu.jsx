import { useEffect, useMemo, useRef, useState } from "react";
import { formatModelRef, modelRefLabel } from "@shared/modelRef.js";
import { ComposerMenuCheckIcon } from "./ComposerAuthMenu.jsx";

export function ComposerModelMenu({ config, currentModel, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const displayLabel = modelRefLabel(currentModel);

  const models = useMemo(() => {
    if (!config?.models) return [];
    return Object.entries(config.models).flatMap(([providerKey, provider]) =>
      provider.models
        .filter(
          (model) =>
            model.state || currentModel === formatModelRef(providerKey, model.id),
        )
        .map((model) => ({
          ref: formatModelRef(providerKey, model.id),
          label: model.id,
        })),
    );
  }, [config, currentModel]);

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
    <div className="composer-model-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`composer-model-btn${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="composer-model-content">
          <span className="composer-model-sizer" aria-hidden="true">
            {displayLabel}
          </span>
          <span className="composer-model-label">{displayLabel}</span>
        </span>
        <span className="composer-model-chevron" aria-hidden="true">
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
        <div className="composer-model-menu" role="menu">
          {models.map((model) => {
            const selected = model.ref === currentModel;
            return (
              <button
                key={model.ref}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`composer-model-item${selected ? " active" : ""}`}
                onClick={() => {
                  onChange(model.ref);
                  setOpen(false);
                }}
              >
                <span className="composer-model-item-label">{model.label}</span>
                <span className="composer-model-item-check">
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
