/** Full model ref for session / LLM: `providerKey/modelId`. */
export function formatModelRef(providerKey, modelId) {
  return `${providerKey}/${modelId}`;
}

/** Parse `providerKey/modelId`, preserving slashes inside the model id. */
export function parseModelRef(ref) {
  const s = String(ref || "");
  const slash = s.indexOf("/");
  if (slash <= 0 || slash === s.length - 1) {
    return null;
  }
  return {
    providerKey: s.slice(0, slash),
    modelId: s.slice(slash + 1),
  };
}

/** Short label for UI (model id only, after the first `/`). */
export function modelRefLabel(ref) {
  const s = String(ref || "");
  const slash = s.indexOf("/");
  return slash >= 0 ? s.slice(slash + 1) : s;
}
