import { useEffect } from "react";

export function ConfirmDialogInfoIcon() {
  return (
    <svg
      className="confirm-dialog-info-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="7.25" stroke="currentColor" strokeWidth="1.25" />
      <path d="M9 8.25V12.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="9" cy="5.75" r="0.75" fill="currentColor" />
    </svg>
  );
}

export function ConfirmDialog({
  title = "CRAgent",
  message,
  detail,
  confirmLabel = "确定",
  cancelLabel = "取消",
  destructive = false,
  onClose,
}) {
  const headerTitle = message || (title !== "CRAgent" ? title : "");
  const bodyText = detail || (message ? null : title !== "CRAgent" ? title : null);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="confirm-overlay" role="presentation">
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={bodyText ? "confirm-dialog-body" : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {headerTitle ? (
          <div className="confirm-dialog-header">
            <ConfirmDialogInfoIcon />
            <h2 id="confirm-dialog-title" className="confirm-dialog-title">
              {headerTitle}
            </h2>
          </div>
        ) : null}
        {bodyText ? (
          <div className="confirm-dialog-body">
            <p id="confirm-dialog-body" className="confirm-dialog-detail">
              {bodyText}
            </p>
          </div>
        ) : null}
        <div className="confirm-dialog-actions">
          <button type="button" className="confirm-dialog-btn" onClick={() => onClose(false)}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-dialog-btn confirm-dialog-btn-primary${destructive ? " destructive" : ""}`}
            onClick={() => onClose(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
