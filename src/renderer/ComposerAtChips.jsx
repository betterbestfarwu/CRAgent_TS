import { atChipDisplayName } from "@shared/atMention.js";
import { resolveProjectFilePath } from "@shared/projectPaths.js";
import { FileTypeIcon } from "./FileTypeIcon.jsx";

function ChipCloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function ComposerAtChips({ mentions, onRemove, projectDirectoryPath = "", fileIcons = {} }) {
  if (!mentions.length) return null;

  return (
    <>
      {mentions.map((mention) => {
        const absolutePath = resolveProjectFilePath(projectDirectoryPath, mention.relativePath);
        const iconUrl = absolutePath ? fileIcons[absolutePath] : "";
        return (
          <span
            key={mention.id}
            className="composer-at-chip composer-file-chip"
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
                {iconUrl ? (
                  <img src={iconUrl} alt="" className="composer-file-sys-icon" width={14} height={14} />
                ) : (
                  <FileTypeIcon name={mention.name} />
                )}
              </span>
              <span className="composer-at-chip-icon composer-at-chip-icon-close">
                <ChipCloseIcon />
              </span>
            </button>
            <span className="composer-at-chip-label">{atChipDisplayName(mention.name)}</span>
          </span>
        );
      })}
    </>
  );
}
