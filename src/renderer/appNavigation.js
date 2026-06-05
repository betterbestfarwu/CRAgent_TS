export function shouldAutoSwitchToChatPage(page, isViewingSession) {
  return isViewingSession && page === "chat";
}
