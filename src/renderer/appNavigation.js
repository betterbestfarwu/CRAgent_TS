export function shouldAutoSwitchToChatPage(page, isViewingSession) {
  return isViewingSession && page === "chat";
}

export function getSessionBusyState(busyBySession, sessionId) {
  if (!sessionId) return false;
  return Boolean(busyBySession?.get?.(sessionId));
}
