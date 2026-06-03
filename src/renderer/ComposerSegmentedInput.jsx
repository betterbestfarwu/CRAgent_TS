import { useLayoutEffect, useMemo, useRef } from "react";
import { applyComposerTextSegmentEdit, buildComposerSegments } from "@shared/atMention.js";
import { ComposerAtChips } from "./ComposerAtChips.jsx";

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

export function ComposerSegmentedInput({
  input,
  onInputChange,
  mentions,
  onRemoveMention,
  textareaRef,
  onResize,
  placeholder,
  onPaste,
  onKeyDown,
}) {
  const segments = useMemo(() => buildComposerSegments(input, mentions), [input, mentions]);
  const mentionById = useMemo(() => new Map(mentions.map((mention) => [mention.id, mention])), [mentions]);
  const textOffsets = useMemo(() => getTextSegmentOffsets(segments), [segments]);
  const mentionSignature = useMemo(
    () => mentions.map((mention) => `${mention.id}:${mention.insertAt ?? "end"}`).join("|"),
    [mentions],
  );
  const prevMentionCountRef = useRef(mentions.length);

  useLayoutEffect(() => {
    const mentionAdded = mentions.length > prevMentionCountRef.current;
    prevMentionCountRef.current = mentions.length;
    if (!mentionAdded) return;
    const el = textareaRef?.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const pos = el.value.length;
    el.setSelectionRange(pos, pos);
  }, [mentions.length, mentionSignature, textareaRef]);

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

  let textIndex = 0;
  const nodes = segments.map((segment, segmentIndex) => {
    if (segment.kind === "mention") {
      const mention = mentionById.get(segment.mentionId);
      if (!mention) return null;
      return (
        <ComposerAtChips
          key={`mention-${segment.mentionId}`}
          mentions={[mention]}
          onRemove={onRemoveMention}
        />
      );
    }

    const currentTextIndex = textIndex;
    textIndex += 1;
    const isPrimary = segmentIndex === segments.length - 1;
    const followsMention = segmentIndex > 0 && segments[segmentIndex - 1]?.kind === "mention";
    const prefixChars = Math.max(segment.content.length, 1);
    const inlineWidthChars = Math.max(segment.content.length, 1);
    const inlineStyle = isPrimary
      ? mentions.length > 0
        ? { width: `${inlineWidthChars}ch` }
        : undefined
      : { width: `${prefixChars}ch` };

    return (
      <textarea
        key={`text-${segmentIndex}-${mentionSignature}-${textOffsets[currentTextIndex]?.start ?? 0}`}
        ref={isPrimary ? textareaRef : undefined}
        className={`composer-input${isPrimary ? " composer-input-primary" : " composer-input-prefix"}${followsMention ? " composer-input-after-mention" : ""}`}
        style={inlineStyle}
        value={segment.content}
        rows={1}
        placeholder={segmentIndex === 0 ? placeholder : ""}
        onChange={(event) => handleSegmentChange(currentTextIndex, event.target.value)}
        onInput={onResize}
        onPaste={onPaste}
        onKeyDown={(event) => onKeyDown?.(event, { textIndex: currentTextIndex, segmentStart: textOffsets[currentTextIndex]?.start ?? 0 })}
      />
    );
  });

  return nodes;
}
