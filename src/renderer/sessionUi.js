export function sessionHasActiveSurface({ session, busy } = {}) {
  return Boolean(session?.messages?.length || busy);
}

export function sessionShowsLoadOlder(session) {
  if (!session?.messages?.length) return false;
  return session.meta?.hasMoreMessages === true;
}
