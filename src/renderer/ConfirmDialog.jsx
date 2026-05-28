import { useEffect } from "react";

const APP_ICON_SRC = `${import.meta.env.BASE_URL}icon.png`;

export function ConfirmDialog({
  title = "CRAgent",
  message,
  detail,
  confirmLabel = "确定",
  cancelLabel = "取消",
  destructive = false,
  onClose,
}) {
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
    <div className="confirm-overlay" role="presentation" onClick={() => onClose(false)}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-message"
        aria-describedby={detail ? "confirm-dialog-detail" : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <img className="confirm-dialog-icon" src={APP_ICON_SRC} alt="" width={64} height={64} />
        {title ? <div className="confirm-dialog-title">{title}</div> : null}
        <p id="confirm-dialog-message" className="confirm-dialog-message">
          {message}
        </p>
        {detail ? (
          <p id="confirm-dialog-detail" className="confirm-dialog-detail">
            {detail}
          </p>
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
