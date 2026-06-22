import { useEffect } from "react";

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
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open, refs, onOutsidePointerDown]);
}
