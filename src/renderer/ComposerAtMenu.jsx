import { useMemo, useState } from "react";
import {
    buildAtNavItems,
    buildPathTreeSegments,
    filterDirectoryEntries,
} from "@shared/atMention.js";

const VISIBLE_LIMIT = 72;

function FileKindIcon({ name, kind }) {
    if (kind === "dir") {
        return (
            <span className="at-menu-item-icon at-menu-item-icon-dir" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    <path d="M2.5 4.75a1.25 1.25 0 0 1 1.25-1.25h3.1l1.15 1.15h5.5a1.25 1.25 0 0 1 1.25 1.25v5.35a1.25 1.25 0 0 1-1.25 1.25h-10.5a1.25 1.25 0 0 1-1.25-1.25v-5.35z" />
                </svg>
            </span>
        );
    }
    const ext = String(name || "").split(".").pop()?.toLowerCase() || "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext)) {
        return (
            <span className="at-menu-item-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                    <rect x="2" y="3" width="12" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
                    <circle cx="5.5" cy="6.5" r="1" fill="currentColor" />
                    <path d="M2 11l3.2-3.2 2.3 2.3L11.5 6 14 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </span>
        );
    }
    if (ext === "css") {
        return (
            <span className="at-menu-item-icon at-menu-item-icon-css" aria-hidden="true">
                #
            </span>
        );
    }
    return (
        <span className="at-menu-item-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path d="M4 2.5h5.2L12.5 5.8V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.2" />
            </svg>
        </span>
    );
}

function PathTreePopover({ projectName, segments }) {
    if (!segments.length) return null;
    return (
        <div className="at-menu-path-tree" aria-hidden="true">
            <div className="at-menu-path-tree-inner">
                <div className="at-menu-path-tree-row">
                    <span className="at-menu-path-tree-icon">
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                            <path d="M2.5 4.75a1.25 1.25 0 0 1 1.25-1.25h3.1l1.15 1.15h5.5a1.25 1.25 0 0 1 1.25 1.25v5.35a1.25 1.25 0 0 1-1.25 1.25h-10.5a1.25 1.25 0 0 1-1.25-1.25v-5.35z" />
                        </svg>
                    </span>
                    <span className="at-menu-path-tree-label">{projectName}</span>
                </div>
                {segments.map((segment, index) => (
                    <div
                        key={`${segment}-${index}`}
                        className="at-menu-path-tree-row"
                        style={{ paddingLeft: `${12 + index * 14}px` }}
                    >
                        <span className="at-menu-path-tree-guide" aria-hidden="true" />
                        <span className="at-menu-path-tree-icon">
                            {index === segments.length - 1 ? (
                                <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                                    <path d="M4 2.5h5.2L12.5 5.8V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.2" />
                                </svg>
                            ) : (
                                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                                    <path d="M2.5 4.75a1.25 1.25 0 0 1 1.25-1.25h3.1l1.15 1.15h5.5a1.25 1.25 0 0 1 1.25 1.25v5.35a1.25 1.25 0 0 1-1.25 1.25h-10.5a1.25 1.25 0 0 1-1.25-1.25v-5.35z" />
                                </svg>
                            )}
                        </span>
                        <span className="at-menu-path-tree-label">{segment}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function activateAtMenuEntry(entry, onEnterDirectory, onPickFile) {
    if (entry.kind === "dir") {
        onEnterDirectory(entry.relativePath);
        return;
    }
    onPickFile(entry.relativePath);
}

export function ComposerAtMenu({
    projectName,
    projectDirectoryPath,
    browseRelativePath,
    entries,
    filter,
    loading,
    error,
    selectedIndex,
    expanded,
    onExpandedChange,
    onHoverIndex,
    onEnterDirectory,
    onGoParent,
    onPickFile,
}) {
    const filtered = useMemo(
        () => filterDirectoryEntries(entries, filter),
        [entries, filter],
    );
    const navItems = useMemo(
        () => buildAtNavItems(filtered, browseRelativePath, Boolean(browseRelativePath)),
        [filtered, browseRelativePath],
    );
    const visibleItems = expanded ? navItems : navItems.slice(0, VISIBLE_LIMIT);
    const hiddenCount = navItems.length - visibleItems.length;
    const [hoveredEntry, setHoveredEntry] = useState(null);

    const pathTree = useMemo(() => {
        if (!hoveredEntry) return null;
        const segments = buildPathTreeSegments(hoveredEntry.relativePath);
        return { segments, leaf: hoveredEntry.name };
    }, [hoveredEntry]);

    if (loading) {
        return (
            <div className="at-menu-wrap">
                <div className="at-menu" role="listbox" aria-label="文件与目录">
                    <div className="at-menu-empty">加载中…</div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="at-menu-wrap">
                <div className="at-menu" role="listbox" aria-label="文件与目录">
                    <div className="at-menu-empty">{error}</div>
                </div>
            </div>
        );
    }

    if (!navItems.length) {
        return (
            <div className="at-menu-wrap">
                <div className="at-menu" role="listbox" aria-label="文件与目录">
                    <div className="at-menu-empty">无匹配项</div>
                </div>
            </div>
        );
    }

    let rowIndex = -1;

    return (
        <div className="at-menu-wrap">
            <div className="at-menu" role="listbox" aria-label="文件与目录">
                <div className="at-menu-section-label">Files & Folders</div>
                {visibleItems.map((item) => {
                    rowIndex += 1;
                    const index = rowIndex;
                    const active = index === selectedIndex;

                    if (item.kind === "parent") {
                        return (
                            <button
                                key="parent"
                                type="button"
                                role="option"
                                aria-selected={active}
                                className={`at-menu-item${active ? " active" : ""}`}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    onGoParent();
                                }}
                                onMouseEnter={() => {
                                    onHoverIndex(index);
                                    setHoveredEntry(null);
                                }}
                            >
                                <FileKindIcon name=".." kind="dir" />
                                <div className="at-menu-item-content">
                                    <div className="at-menu-item-title">..</div>
                                    <div className="at-menu-item-desc">上级目录</div>
                                </div>
                            </button>
                        );
                    }

                    const { entry } = item;
                    const parentLabel = entry.relativePath.includes("/")
                        ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/"))
                        : projectName;

                    return (
                        <button
                            key={entry.relativePath}
                            type="button"
                            role="option"
                            aria-selected={active}
                            className={`at-menu-item${active ? " active" : ""}`}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                activateAtMenuEntry(entry, onEnterDirectory, onPickFile);
                            }}
                            onMouseEnter={() => {
                                onHoverIndex(index);
                                setHoveredEntry(entry);
                            }}
                        >
                            <FileKindIcon name={entry.name} kind={entry.kind} />
                            <div className="at-menu-item-content">
                                <div className="at-menu-item-title">{entry.name}</div>
                                <div className="at-menu-item-desc">{parentLabel || projectDirectoryPath}</div>
                            </div>
                            {entry.kind === "dir" ? (
                                <span className="at-menu-item-chevron" aria-hidden="true">
                                    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                                        <path d="M6 4.5 10.5 8 6 11.5V4.5Z" />
                                    </svg>
                                </span>
                            ) : null}
                        </button>
                    );
                })}
                {hiddenCount > 0 && !expanded ? (
                    <button
                        type="button"
                        className="at-menu-more"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onExpandedChange(true)}
                    >
                        Show {hiddenCount} more
                    </button>
                ) : null}
            </div>
            {pathTree ? (
                <PathTreePopover projectName={projectName} segments={pathTree.segments} />
            ) : null}
        </div>
    );
}
