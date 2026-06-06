import { useEffect } from "react";

export function ImageViewer({ src, alt = "图片", onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!src) return null;

  return (
    <div className="image-viewer-overlay" role="presentation">
      <div
        className="image-viewer-panel"
        role="dialog"
        aria-modal="true"
        aria-label="图像浏览"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="image-viewer-close"
          title="关闭"
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </button>
        <img className="image-viewer-img" src={src} alt={alt} />
      </div>
    </div>
  );
}
