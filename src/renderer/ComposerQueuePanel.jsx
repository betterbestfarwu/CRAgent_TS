import { useState } from "react";

const ICON_TRASH = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const ICON_GRIP = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.5" />
    <circle cx="15" cy="6" r="1.5" />
    <circle cx="9" cy="12" r="1.5" />
    <circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="18" r="1.5" />
    <circle cx="15" cy="18" r="1.5" />
  </svg>
);

function queueItemText(item) {
  return String(item?.userText || item?.input || "").trim();
}

function QueueItemImages({ images }) {
  if (!Array.isArray(images) || !images.length) {
    return null;
  }

  return (
    <div className="composer-queue-images">
      {images.map((image, index) => {
        const dataUrl = image?.dataUrl || image?.data_url || "";
        if (dataUrl) {
          return (
            <img
              key={index}
              src={dataUrl}
              alt=""
              className="composer-queue-image"
              draggable={false}
            />
          );
        }
        return (
          <div key={index} className="composer-queue-image-placeholder">
            Image
          </div>
        );
      })}
    </div>
  );
}

export function ComposerQueuePanel({ queue, open, onToggle, onRemove, onReorder }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  if (!queue.length) {
    return null;
  }

  function handleDragStart(index, event) {
    setDragIndex(index);
    setDropIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }

  function handleDragOver(index, event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropIndex !== index) {
      setDropIndex(index);
    }
  }

  function handleDrop(index, event) {
    event.preventDefault();
    const fromIndex = dragIndex ?? Number(event.dataTransfer.getData("text/plain"));
    if (!Number.isInteger(fromIndex) || fromIndex === index) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }
    onReorder?.(fromIndex, index);
    setDragIndex(null);
    setDropIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDropIndex(null);
  }

  return (
    <div className="composer-queue-wrap">
      <button
        type="button"
        className="composer-queue-toggle has-items"
        onClick={onToggle}
        title="排队消息"
        aria-expanded={open}
        aria-label={`排队消息 ${queue.length} 条`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        <span className="composer-queue-count">{queue.length}</span>
      </button>
      {open ? (
        <div className="composer-queue-panel">
          <div className="composer-queue-title">任务列表</div>
          <div className="composer-queue-list" role="list">
            {queue.map((item, index) => {
              const text = queueItemText(item);
              const dragging = dragIndex === index;
              const dragOver = dropIndex === index && dragIndex !== index;

              return (
                <div
                  key={item.id}
                  className={`composer-queue-item${dragging ? " dragging" : ""}${dragOver ? " drag-over" : ""}`}
                  role="listitem"
                  draggable
                  onDragStart={(event) => handleDragStart(index, event)}
                  onDragOver={(event) => handleDragOver(index, event)}
                  onDrop={(event) => handleDrop(index, event)}
                  onDragEnd={handleDragEnd}
                >
                  <span className="composer-queue-drag-handle" aria-hidden="true">
                    {ICON_GRIP}
                  </span>
                  <div className="composer-queue-item-body">
                    {text ? <span className="composer-queue-text">{text}</span> : null}
                    <QueueItemImages images={item.images} />
                  </div>
                  <span className="composer-queue-actions">
                    <button
                      type="button"
                      className="composer-queue-delete"
                      onClick={() => onRemove?.(item.id)}
                      onMouseDown={(event) => event.stopPropagation()}
                      title="删除"
                      aria-label="删除"
                    >
                      {ICON_TRASH}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
