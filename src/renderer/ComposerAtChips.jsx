export function ComposerAtChips({ mentions, onRemove }) {
  if (!mentions.length) return null;

  return (
    <>
      {mentions.map((mention) => (
        <span
          key={mention.id}
          className="composer-at-chip"
          title={mention.relativePath}
        >
          <button
            type="button"
            className="composer-at-chip-remove"
            title="移除"
            aria-label={`移除 ${mention.name}`}
            onClick={() => onRemove?.(mention.id)}
          >
            ×
          </button>
          <span className="composer-at-chip-label">{mention.name}</span>
        </span>
      ))}
    </>
  );
}
