import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { applyComposerTextSegmentEdit, buildComposerDisplaySegments, buildComposerSegments } from "@shared/atMention.js";
import { resolveProjectFilePath } from "@shared/projectPaths.js";
import {
  collectComposerAddedChips,
  ensureComposerCaretAnchor,
  getComposerEditorCaretOffset,
  parseComposerEditorDom,
  placeComposerCaretAfterChip,
  restoreComposerEditorCaretAtOffset,
  syncComposerEditorRefsAfterInternalEdit,
} from "@shared/composerEditor.js";
import { applyComposerEditShortcut } from "@shared/composerEditShortcuts.js";
import {
  createFileChipElement,
  createMentionChipElement,
  updateComposerChipIconsInDom,
} from "./composerFileChipDom.js";

function getTextSegmentOffsets(segments) {
  const offsets = [];
  let cursor = 0;
  let textIndex = 0;
  for (const segment of segments) {
    if (segment.kind !== "text") continue;
    offsets.push({
      textIndex,
      start: cursor,
      end: cursor + segment.content.length,
      content: segment.content,
    });
    cursor += segment.content.length;
    textIndex += 1;
  }
  return offsets;
}

function rebuildComposerEditorDom(root, segments, mentionById, fileById, fileIcons, projectDirectoryPath) {
  const fragment = document.createDocumentFragment();
  for (const segment of segments) {
    if (segment.kind === "text") {
      if (segment.content) {
        fragment.appendChild(document.createTextNode(segment.content));
      }
      continue;
    }
    if (segment.kind === "file") {
      const file = fileById.get(segment.fileId);
      if (file) {
        const path = file.path?.trim() || "";
        fragment.appendChild(createFileChipElement(file, path ? fileIcons[path] : ""));
      }
      continue;
    }
    const mention = mentionById.get(segment.mentionId);
    if (mention) {
      const absolutePath = resolveProjectFilePath(projectDirectoryPath, mention.relativePath);
      const iconUrl = absolutePath ? fileIcons[absolutePath] : "";
      fragment.appendChild(createMentionChipElement(mention, absolutePath, iconUrl));
    }
  }
  ensureComposerCaretAnchor(fragment);
  root.replaceChildren(fragment);
}

function ComposerInlineEditor({
  input,
  onInputChange,
  onCaretChange,
  composerCaret = 0,
  mentions,
  onRemoveMention,
  files,
  onRemoveFile,
  fileIcons,
  projectDirectoryPath = "",
  editorRef,
  onResize,
  placeholder,
  onPaste,
  onKeyDown,
}) {
  const rootRef = useRef(null);
  const segments = useMemo(
    () => buildComposerDisplaySegments(input, mentions, files),
    [input, mentions, files],
  );
  const mentionById = useMemo(() => new Map(mentions.map((mention) => [mention.id, mention])), [mentions]);
  const fileById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const mentionSignature = useMemo(
    () => mentions.map((mention) => `${mention.id}:${mention.insertAt ?? "end"}`).join("|"),
    [mentions],
  );
  const filesSignature = useMemo(
    () => files.map((file) => `${file.id}:${file.path || ""}:${file.insertAt ?? "end"}`).join("|"),
    [files],
  );
  const internalEditRef = useRef(false);
  const lastSyncedInputRef = useRef(null);
  const lastMentionSignatureRef = useRef(null);
  const lastFilesSignatureRef = useRef(null);
  const lastProjectDirectoryPathRef = useRef(projectDirectoryPath);
  const prevMentionCountRef = useRef(mentions.length);
  const prevFileCountRef = useRef(files.length);
  const prevMentionIdsRef = useRef(new Set());
  const prevFileIdsRef = useRef(new Set());

  const syncFromState = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    rebuildComposerEditorDom(root, segments, mentionById, fileById, fileIcons, projectDirectoryPath);
    lastSyncedInputRef.current = input;
    lastMentionSignatureRef.current = mentionSignature;
    lastFilesSignatureRef.current = filesSignature;
  }, [input, mentionById, fileById, mentionSignature, segments, files, fileIcons, filesSignature, projectDirectoryPath]);

  useLayoutEffect(() => {
    if (internalEditRef.current) {
      syncComposerEditorRefsAfterInternalEdit(
        {
          internalEditRef,
          lastSyncedInputRef,
          lastMentionSignatureRef,
          lastFilesSignatureRef,
          lastProjectDirectoryPathRef,
          prevMentionCountRef,
          prevFileCountRef,
          prevMentionIdsRef,
          prevFileIdsRef,
        },
        {
          input,
          mentionSignature,
          filesSignature,
          projectDirectoryPath,
          mentions,
          files,
        },
      );
      return;
    }

    const structureChanged =
      mentionSignature !== lastMentionSignatureRef.current ||
      filesSignature !== lastFilesSignatureRef.current ||
      projectDirectoryPath !== lastProjectDirectoryPathRef.current;
    const inputChangedExternally = input !== lastSyncedInputRef.current;
    if (!structureChanged && !inputChangedExternally) return;

    const previousMentionIds = prevMentionIdsRef.current;
    const previousFileIds = prevFileIdsRef.current;
    const addedChips = collectComposerAddedChips({
      mentions,
      files,
      previousMentionIds,
      previousFileIds,
    });
    const addedChip = addedChips[addedChips.length - 1] ?? null;
    const mentionRemoved = mentions.length < prevMentionCountRef.current;
    const fileRemoved = files.length < prevFileCountRef.current;
    prevMentionCountRef.current = mentions.length;
    prevFileCountRef.current = files.length;
    prevMentionIdsRef.current = new Set(mentions.map((mention) => mention.id));
    prevFileIdsRef.current = new Set(files.map((file) => file.id));
    lastProjectDirectoryPathRef.current = projectDirectoryPath;
    syncFromState();
    if (addedChip) {
      restoreCaretAfterChip(addedChip);
    } else if (mentionRemoved || fileRemoved) {
      restoreComposerEditorCaretAtOffset(rootRef.current, composerCaret);
    }
    onResize?.();
  }, [
    input,
    mentionSignature,
    filesSignature,
    projectDirectoryPath,
    mentions.length,
    files.length,
    composerCaret,
    onResize,
    syncFromState,
  ]);

  useLayoutEffect(() => {
    updateComposerChipIconsInDom(rootRef.current, fileIcons);
  }, [fileIcons]);

  function restoreCaretAfterChip(chipRef) {
    const root = rootRef.current;
    if (!root) return;
    const apply = () => {
      if (placeComposerCaretAfterChip(root, chipRef) && typeof root.focus === "function") {
        root.focus({ preventScroll: true });
      }
    };
    apply();
    requestAnimationFrame(apply);
    window.setTimeout(apply, 0);
  }

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    function handleClick(event) {
      const button = event.target.closest(".composer-at-chip-icon-btn");
      if (!button || !root.contains(button)) return;
      event.preventDefault();
      const chip = button.closest(".composer-at-chip");
      const fileId = chip?.dataset?.fileId;
      if (fileId) {
        onRemoveFile?.(fileId);
        return;
      }
      const mentionId = chip?.dataset?.mentionId;
      if (mentionId) onRemoveMention?.(mentionId);
    }

    root.addEventListener("click", handleClick);
    return () => root.removeEventListener("click", handleClick);
  }, [onRemoveFile, onRemoveMention]);

  function reportCaret() {
    const root = rootRef.current;
    if (!root) return;
    onCaretChange?.(getComposerEditorCaretOffset(root));
  }

  function handleInput() {
    const root = rootRef.current;
    if (!root) return;
    const parsed = parseComposerEditorDom(root, mentionById);
    const nextMentions = parsed.mentions.map((mention) => {
      const known = mentionById.get(mention.id);
      return known ? { ...known, insertAt: mention.insertAt } : mention;
    });
    const nextFiles = parsed.files
      .map((fileRef) => {
        const known = fileById.get(fileRef.id);
        return known ? { ...known, insertAt: fileRef.insertAt } : null;
      })
      .filter(Boolean);
    internalEditRef.current = true;
    onInputChange(parsed.text, nextMentions, undefined, nextFiles);
    reportCaret();
    onResize?.();
  }

  return (
    <div
      ref={(node) => {
        rootRef.current = node;
        if (editorRef) editorRef.current = node;
      }}
      className="composer-input composer-input-editor composer-input-primary"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      onInput={handleInput}
      onPaste={onPaste}
      onKeyUp={reportCaret}
      onClick={reportCaret}
      onSelect={reportCaret}
      onKeyDown={(event) => {
        if (
          applyComposerEditShortcut(event, {
            contentEditable: true,
            onAfterCut: () => queueMicrotask(handleInput),
          })
        ) {
          return;
        }
        onKeyDown?.(event, { contentEditable: true });
      }}
    />
  );
}

function ComposerPlainTextarea({
  input,
  onInputChange,
  onCaretChange,
  mentions,
  textareaRef,
  onResize,
  placeholder,
  onPaste,
  onKeyDown,
}) {
  const segments = useMemo(() => buildComposerSegments(input, mentions), [input, mentions]);
  const textOffsets = useMemo(() => getTextSegmentOffsets(segments), [segments]);
  const segmentStart = textOffsets[0]?.start ?? 0;

  function reportCaret(event) {
    const el = event?.currentTarget ?? textareaRef?.current;
    if (!el) return;
    onCaretChange?.(segmentStart + (el.selectionStart ?? el.value?.length ?? 0));
  }

  function handleSegmentChange(textIndex, nextContent, event) {
    const offset = textOffsets[textIndex];
    if (!offset) return;
    const { text, mentions: nextMentions } = applyComposerTextSegmentEdit(
      input,
      offset.start,
      offset.end,
      nextContent,
      mentions,
    );
    onInputChange(text, nextMentions);
    reportCaret(event);
  }

  const segment = segments[0];
  if (segment?.kind !== "text") return null;

  return (
    <textarea
      ref={textareaRef}
      className="composer-input composer-input-primary"
      value={segment.content}
      rows={1}
      placeholder={placeholder}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      onChange={(event) => handleSegmentChange(0, event.target.value, event)}
      onInput={onResize}
      onPaste={onPaste}
      onKeyUp={reportCaret}
      onClick={reportCaret}
      onSelect={reportCaret}
      onKeyDown={(event) => {
        if (applyComposerEditShortcut(event, { contentEditable: false })) {
          return;
        }
        onKeyDown?.(event, {
          textIndex: 0,
          segmentStart,
        });
      }}
    />
  );
}

export function ComposerSegmentedInput({
  input,
  onInputChange,
  onCaretChange,
  composerCaret = 0,
  mentions,
  onRemoveMention,
  files = [],
  onRemoveFile,
  fileIcons = {},
  projectDirectoryPath = "",
  textareaRef,
  onResize,
  placeholder,
  onPaste,
  onKeyDown,
}) {
  if (mentions.length > 0 || files.length > 0) {
    return (
      <ComposerInlineEditor
        input={input}
        onInputChange={onInputChange}
        onCaretChange={onCaretChange}
        composerCaret={composerCaret}
        mentions={mentions}
        onRemoveMention={onRemoveMention}
        files={files}
        onRemoveFile={onRemoveFile}
        fileIcons={fileIcons}
        projectDirectoryPath={projectDirectoryPath}
        editorRef={textareaRef}
        onResize={onResize}
        placeholder={placeholder}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
      />
    );
  }

  return (
    <ComposerPlainTextarea
      input={input}
      onInputChange={onInputChange}
      onCaretChange={onCaretChange}
      mentions={mentions}
      textareaRef={textareaRef}
      onResize={onResize}
      placeholder={placeholder}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
    />
  );
}
