import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { applyComposerTextSegmentEdit, buildComposerSegments } from "@shared/atMention.js";
import { resolveProjectFilePath } from "@shared/projectPaths.js";
import {
  ensureComposerCaretAnchor,
  parseComposerEditorDom,
  restoreComposerEditorCaret,
} from "@shared/composerEditor.js";
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

function rebuildComposerEditorDom(root, segments, mentionById, files, fileIcons, projectDirectoryPath) {
  const fragment = document.createDocumentFragment();
  for (const file of files) {
    const path = file.path?.trim() || "";
    fragment.appendChild(createFileChipElement(file, path ? fileIcons[path] : ""));
  }
  for (const segment of segments) {
    if (segment.kind === "text") {
      if (segment.content) {
        fragment.appendChild(document.createTextNode(segment.content));
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
  const segments = useMemo(() => buildComposerSegments(input, mentions), [input, mentions]);
  const mentionById = useMemo(() => new Map(mentions.map((mention) => [mention.id, mention])), [mentions]);
  const mentionSignature = useMemo(
    () => mentions.map((mention) => `${mention.id}:${mention.insertAt ?? "end"}`).join("|"),
    [mentions],
  );
  const filesSignature = useMemo(
    () => files.map((file) => `${file.id}:${file.path || ""}`).join("|"),
    [files],
  );
  const internalEditRef = useRef(false);
  const lastSyncedInputRef = useRef(null);
  const lastMentionSignatureRef = useRef(null);
  const lastFilesSignatureRef = useRef(null);
  const lastProjectDirectoryPathRef = useRef(projectDirectoryPath);
  const prevMentionCountRef = useRef(mentions.length);
  const prevFileCountRef = useRef(files.length);

  const syncFromState = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    rebuildComposerEditorDom(root, segments, mentionById, files, fileIcons, projectDirectoryPath);
    lastSyncedInputRef.current = input;
    lastMentionSignatureRef.current = mentionSignature;
    lastFilesSignatureRef.current = filesSignature;
  }, [input, mentionById, mentionSignature, segments, files, fileIcons, filesSignature, projectDirectoryPath]);

  useLayoutEffect(() => {
    if (internalEditRef.current) {
      internalEditRef.current = false;
      lastSyncedInputRef.current = input;
      return;
    }

    const structureChanged =
      mentionSignature !== lastMentionSignatureRef.current ||
      filesSignature !== lastFilesSignatureRef.current ||
      projectDirectoryPath !== lastProjectDirectoryPathRef.current;
    const inputChangedExternally = input !== lastSyncedInputRef.current;
    if (!structureChanged && !inputChangedExternally) return;

    const mentionAdded = mentions.length > prevMentionCountRef.current;
    const fileAdded = files.length > prevFileCountRef.current;
    prevMentionCountRef.current = mentions.length;
    prevFileCountRef.current = files.length;
    lastProjectDirectoryPathRef.current = projectDirectoryPath;
    syncFromState();
    if (mentionAdded || fileAdded) {
      restoreComposerEditorCaret(rootRef.current);
    }
    onResize?.();
  }, [
    input,
    mentionSignature,
    filesSignature,
    projectDirectoryPath,
    mentions.length,
    files.length,
    onResize,
    syncFromState,
  ]);

  useLayoutEffect(() => {
    updateComposerChipIconsInDom(rootRef.current, fileIcons);
  }, [fileIcons]);

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

  function handleInput() {
    const root = rootRef.current;
    if (!root) return;
    const parsed = parseComposerEditorDom(root, mentionById);
    const nextMentions = parsed.mentions.map((mention) => {
      const known = mentionById.get(mention.id);
      return known ? { ...known, insertAt: mention.insertAt } : mention;
    });
    internalEditRef.current = true;
    onInputChange(parsed.text, nextMentions);
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
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      onInput={handleInput}
      onPaste={onPaste}
      onKeyDown={(event) => onKeyDown?.(event, { contentEditable: true })}
    />
  );
}

function ComposerPlainTextarea({
  input,
  onInputChange,
  mentions,
  textareaRef,
  onResize,
  placeholder,
  onPaste,
  onKeyDown,
}) {
  const segments = useMemo(() => buildComposerSegments(input, mentions), [input, mentions]);
  const textOffsets = useMemo(() => getTextSegmentOffsets(segments), [segments]);

  function handleSegmentChange(textIndex, nextContent) {
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
      onChange={(event) => handleSegmentChange(0, event.target.value)}
      onInput={onResize}
      onPaste={onPaste}
      onKeyDown={(event) =>
        onKeyDown?.(event, {
          textIndex: 0,
          segmentStart: textOffsets[0]?.start ?? 0,
        })
      }
    />
  );
}

export function ComposerSegmentedInput({
  input,
  onInputChange,
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
      mentions={mentions}
      textareaRef={textareaRef}
      onResize={onResize}
      placeholder={placeholder}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
    />
  );
}
