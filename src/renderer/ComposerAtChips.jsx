import { atChipDisplayName } from "@shared/atMention.js";

function AtChipFileIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M4 2.5h5.2L12.5 5.8V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function AtChipCloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

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
            className="composer-at-chip-icon-btn"
            title="移除"
            aria-label={`移除 ${mention.name}`}
            onClick={() => onRemove?.(mention.id)}
          >
            <span className="composer-at-chip-icon composer-at-chip-icon-file">
              <AtChipFileIcon />
            </span>
            <span className="composer-at-chip-icon composer-at-chip-icon-close">
              <AtChipCloseIcon />
            </span>
          </button>
          <span className="composer-at-chip-label">{atChipDisplayName(mention.name)}</span>
        </span>
      ))}
    </>
  );
}
