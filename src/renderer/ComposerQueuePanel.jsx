export function ComposerQueuePanel({ queue, open, onToggle, onRemove }) {
  if (!queue.length) {
    return null;
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
        <div className="composer-queue-panel" role="list">
          {queue.map((item) => (
            <div key={item.id} className="composer-queue-item" role="listitem">
              <span className="composer-queue-text">{item.input}</span>
              <span className="composer-queue-actions">
                <button type="button" onClick={() => onRemove?.(item.id)} title="删除">
                  删除
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
