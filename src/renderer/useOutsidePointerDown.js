import { useEffect } from "react";

export const FRAME_POINTER_DOWN_EVENT = "cragent:frame-pointer-down";

function eventTargetsRef(event, ref) {
  const element = ref?.current;
  if (!element) return false;
  const path = typeof event.composedPath === "function" ? event.composedPath() : null;
  return path ? path.includes(element) : element.contains(event.target);
}

export function useOutsidePointerDown(open, refs, onOutsidePointerDown) {
  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (refs.some((ref) => eventTargetsRef(event, ref))) return;
      onOutsidePointerDown?.(event);
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener(FRAME_POINTER_DOWN_EVENT, handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener(FRAME_POINTER_DOWN_EVENT, handlePointerDown);
    };
  }, [open, refs, onOutsidePointerDown]);
}
