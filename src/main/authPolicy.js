import { normalizeAuthMode } from "@shared/authMode.js";

export function createAuthAwareConfirm(baseConfirm, getAuthMode) {
  return async (toolName, details) => {
    const mode = normalizeAuthMode(getAuthMode());
    if (mode === "fullAccess") {
      return true;
    }
    if (mode === "autoReview") {
      return true;
    }
    return baseConfirm(toolName, details);
  };
}

export function shouldRequireToolConfirmation(tool, getAuthMode) {
  if (!tool.requiresConfirmation) {
    return false;
  }
  const mode = normalizeAuthMode(getAuthMode());
  if (mode === "fullAccess") {
    return false;
  }
  if (mode === "autoReview") {
    return false;
  }
  return true;
}

export function shouldRequireBashConfirmation(safety, getAuthMode) {
  if (safety.kind !== "needsConfirmation") {
    return false;
  }
  const mode = normalizeAuthMode(getAuthMode());
  if (mode === "fullAccess" || mode === "autoReview") {
    return false;
  }
  return true;
}

export function shouldRequireNetworkConfirmation(getAuthMode) {
  const mode = normalizeAuthMode(getAuthMode());
  return mode === "default";
}
