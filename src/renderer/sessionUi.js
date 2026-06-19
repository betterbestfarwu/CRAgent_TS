export function sessionHasActiveSurface({ session, busy } = {}) {
  return Boolean(session?.messages?.length || busy);
}

export function sessionShowsLoadOlder(session) {
  if (!session?.messages?.length) return false;
  const loadedCount = session.messages.length;
  const totalCount = session.meta?.messageCount ?? loadedCount;
  return totalCount > loadedCount;
}
