import { useMemo } from "react";
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
    const prefixChars = Math.max(segment.content.length, 1);

    return (
      <textarea
        key={`text-${currentTextIndex}-${textOffsets[currentTextIndex]?.start ?? 0}`}
        ref={isPrimary ? textareaRef : undefined}
        className={`composer-input${isPrimary ? " composer-input-primary" : " composer-input-prefix"}`}
        style={isPrimary ? undefined : { width: `${prefixChars}ch` }}
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
