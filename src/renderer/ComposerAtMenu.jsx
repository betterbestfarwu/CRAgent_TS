import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    buildAtNavItems,
    buildPathTreeSegments,
    filterDirectoryEntries,
    parentRelativePath,
} from "@shared/atMention.js";
import { resolveProjectFilePath } from "@shared/projectPaths.js";
import { FileTypeIcon } from "./FileTypeIcon.jsx";

const VISIBLE_LIMIT = 72;
const DIRECTORY_TEXT_PICK_PADDING_PX = 2;

/**
 * @param {HTMLElement | null | undefined} element
 * @returns {number}
 */
function measureElementTextWidth(element) {
    if (!element) return 0;
    const text = element.textContent || "";
    if (!text) return 0;
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return element.getBoundingClientRect().width;
    context.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return context.measureText(text).width;
}

/**
 * Visible glyph width for pick-zone hit testing. Truncated titles must not use
 * the full string width or the pick zone extends over the enter/chevron area.
 * @param {HTMLElement} element
 * @returns {number}
 */
function measureVisibleTextWidth(element) {
    const fullWidth = measureElementTextWidth(element);
    const isTruncated = element.scrollWidth > element.clientWidth + 1;
    if (!isTruncated) return fullWidth;

    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = range.getClientRects();
    if (rects.length) {
        const titleLeft = element.getBoundingClientRect().left;
        let visibleRight = titleLeft;
        for (const rect of rects) {
            visibleRight = Math.max(visibleRight, rect.right);
        }
        return Math.max(0, visibleRight - titleLeft);
    }

    const ellipsisReserve = 14;
    return Math.max(0, element.clientWidth - ellipsisReserve);
}

/**
 * @param {HTMLElement} rowElement
 * @param {number} clientX
 * @returns {boolean}
 */
function isDirectoryPickClick(rowElement, clientX) {
    const titleEl = rowElement.querySelector(".at-menu-item-title");
    if (!titleEl) return false;
    const titleRect = titleEl.getBoundingClientRect();
    const textWidth = measureVisibleTextWidth(titleEl);
    const pickZoneLeft = titleRect.left - DIRECTORY_TEXT_PICK_PADDING_PX;
    const pickZoneRight = titleRect.left + textWidth + DIRECTORY_TEXT_PICK_PADDING_PX;
    return clientX >= pickZoneLeft && clientX <= pickZoneRight;
}

/**
 * @param {import("react").MouseEvent<HTMLElement>} event
 * @param {{ relativePath: string }} entry
 * @param {(relativePath: string) => void} onPickFile
 * @param {(relativePath: string) => void} onEnterDirectory
 */
function handleDirectoryRowMouseDown(event, entry, onPickFile, onEnterDirectory) {
    event.preventDefault();
    if (isDirectoryPickClick(event.currentTarget, event.clientX)) {
        onPickFile(entry.relativePath);
        return;
    }
    onEnterDirectory(entry.relativePath);
}

function FolderFallbackIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M2.5 4.75a1.25 1.25 0 0 1 1.25-1.25h3.1l1.15 1.15h5.5a1.25 1.25 0 0 1 1.25 1.25v5.35a1.25 1.25 0 0 1-1.25 1.25h-10.5a1.25 1.25 0 0 1-1.25-1.25v-5.35z" />
        </svg>
    );
}

function AtMenuEntryIcon({ name, kind, relativePath, projectDirectoryPath, fileIcons }) {
    const absolutePath =
        resolveProjectFilePath(projectDirectoryPath, relativePath) ||
        (kind === "dir" ? String(projectDirectoryPath ?? "").trim() : "");
    const iconUrl = absolutePath ? fileIcons[absolutePath] : "";

    return (
        <span
            className={`at-menu-item-icon${kind === "dir" && !iconUrl ? " at-menu-item-icon-dir" : ""}`}
            aria-hidden="true"
        >
            {iconUrl ? (
                <img src={iconUrl} alt="" className="composer-file-sys-icon" width={16} height={16} />
            ) : kind === "dir" ? (
                <FolderFallbackIcon />
            ) : (
                <FileTypeIcon name={name} size={16} />
            )}
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

export function ComposerAtMenu({
    projectName,
    projectDirectoryPath = "",
    fileIcons = {},
    browseRelativePath,
    entries,
    filter,
    searchFilter,
    loading,
    error,
    selectedIndex,
    expanded,
    onExpandedChange,
    onHoverIndex,
    onSearchFilterChange,
    onEnterDirectory,
    onGoParent,
    onPickFile,
}) {
    const filtered = useMemo(
        () => filterDirectoryEntries(entries, filter, searchFilter),
        [entries, filter, searchFilter],
    );
    const navItems = useMemo(
        () => buildAtNavItems(filtered, browseRelativePath, Boolean(browseRelativePath)),
        [filtered, browseRelativePath],
    );
    const visibleItems = expanded ? navItems : navItems.slice(0, VISIBLE_LIMIT);
    const hiddenCount = navItems.length - visibleItems.length;
    const [hoveredEntry, setHoveredEntry] = useState(null);
    const searchInputRef = useRef(null);
    const keepSearchFocusRef = useRef(false);

    const pathTree = useMemo(() => {
        if (!hoveredEntry) return null;
        const segments = buildPathTreeSegments(hoveredEntry.relativePath);
        return { segments, leaf: hoveredEntry.name };
    }, [hoveredEntry]);

    useLayoutEffect(() => {
        if (!keepSearchFocusRef.current) return;
        const input = searchInputRef.current;
        if (!input || document.activeElement === input) return;
        input.focus();
        const pos = input.value.length;
        input.setSelectionRange(pos, pos);
    }, [loading, error, searchFilter, navItems.length]);

    let rowIndex = -1;

    return (
        <div className="at-menu-wrap">
            <div className="at-menu" role="listbox" aria-label="文件与目录">
                <div className="at-menu-section-label">Files & Folders</div>
                {loading ? <div className="at-menu-empty">加载中…</div> : null}
                {!loading && error ? <div className="at-menu-empty">{error}</div> : null}
                {!loading && !error && !navItems.length ? (
                    <div className="at-menu-empty">无匹配项</div>
                ) : null}
                {!loading && !error
                    ? visibleItems.map((item) => {
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
                                <AtMenuEntryIcon
                                    name=".."
                                    kind="dir"
                                    relativePath={parentRelativePath(browseRelativePath)}
                                    projectDirectoryPath={projectDirectoryPath}
                                    fileIcons={fileIcons}
                                />
                                <div className="at-menu-item-content">
                                    <div className="at-menu-item-title">.. (上级目录)</div>
                                </div>
                            </button>
                        );
                    }

                    const { entry } = item;

                    if (entry.kind === "dir") {
                        return (
                            <div
                                key={entry.relativePath}
                                role="option"
                                aria-selected={active}
                                className={`at-menu-item-row at-menu-item-row-dir${active ? " active" : ""}`}
                                onMouseDown={(e) =>
                                    handleDirectoryRowMouseDown(e, entry, onPickFile, onEnterDirectory)
                                }
                                onMouseEnter={() => {
                                    onHoverIndex(index);
                                    setHoveredEntry(entry);
                                }}
                            >
                                <div className="at-menu-item">
                                    <span
                                        className="at-menu-item-enter-hit"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onEnterDirectory(entry.relativePath);
                                        }}
                                    >
                                        <AtMenuEntryIcon
                                            name={entry.name}
                                            kind={entry.kind}
                                            relativePath={entry.relativePath}
                                            projectDirectoryPath={projectDirectoryPath}
                                            fileIcons={fileIcons}
                                        />
                                    </span>
                                    <div className="at-menu-item-content">
                                        <div className="at-menu-item-title">{entry.name}</div>
                                    </div>
                                </div>
                                <span
                                    className="at-menu-item-chevron at-menu-item-enter-hit"
                                    aria-hidden="true"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onEnterDirectory(entry.relativePath);
                                    }}
                                >
                                    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                                        <path d="M6 4.5 10.5 8 6 11.5V4.5Z" />
                                    </svg>
                                </span>
                            </div>
                        );
                    }

                    return (
                        <div
                            key={entry.relativePath}
                            role="presentation"
                            className={`at-menu-item-row${active ? " active" : ""}`}
                            onMouseEnter={() => {
                                onHoverIndex(index);
                                setHoveredEntry(entry);
                            }}
                        >
                            <button
                                type="button"
                                role="option"
                                aria-selected={active}
                                className="at-menu-item"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    onPickFile(entry.relativePath);
                                }}
                            >
                                <AtMenuEntryIcon
                                    name={entry.name}
                                    kind={entry.kind}
                                    relativePath={entry.relativePath}
                                    projectDirectoryPath={projectDirectoryPath}
                                    fileIcons={fileIcons}
                                />
                                <div className="at-menu-item-content">
                                    <div className="at-menu-item-title">{entry.name}</div>
                                </div>
                            </button>
                        </div>
                    );
                })
                    : null}
                {!loading && !error && hiddenCount > 0 && !expanded ? (
                    <button
                        type="button"
                        className="at-menu-more"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onExpandedChange(true)}
                    >
                        Show {hiddenCount} more
                    </button>
                ) : null}
                <div className="at-menu-search">
                    <input
                        ref={searchInputRef}
                        type="text"
                        role="searchbox"
                        value={searchFilter}
                        placeholder="Search files and folders"
                        aria-label="搜索当前目录文件和文件夹"
                        onChange={(event) => {
                            keepSearchFocusRef.current = true;
                            onSearchFilterChange(event.target.value);
                            onHoverIndex(0);
                        }}
                        onFocus={() => {
                            keepSearchFocusRef.current = true;
                        }}
                        onBlur={() => {
                            keepSearchFocusRef.current = false;
                        }}
                        onMouseDown={(event) => {
                            event.stopPropagation();
                        }}
                        onKeyDown={(event) => {
                            event.stopPropagation();
                        }}
                    />
                </div>
            </div>
            {pathTree ? (
                <PathTreePopover projectName={projectName} segments={pathTree.segments} />
            ) : null}
        </div>
    );
}
