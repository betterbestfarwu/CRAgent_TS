/** Full model ref for session / LLM: `providerKey/modelId`. */
export function formatModelRef(providerKey, modelId) {
  return `${providerKey}/${modelId}`;
}

/** Short label for UI (model id only, after the first `/`). */
export function modelRefLabel(ref) {
  const s = String(ref || "");
  const slash = s.indexOf("/");
  return slash >= 0 ? s.slice(slash + 1) : s;
}
