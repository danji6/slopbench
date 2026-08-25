export type NotificationSurface = 'discard' | 'toast' | 'desktop' | 'none'

export type NotificationPeer = {
  tabId: string
  startedAt: number
  focused: boolean
  sessionId: string | null
}

/** Chooses exactly one delivery surface across all live same origin tabs. */
export function chooseNotificationSurface(
  peers: NotificationPeer[],
  ownTabId: string,
  notificationSessionId: string,
): NotificationSurface {
  const focused = peers.filter((peer) => peer.focused)
  if (focused.some((peer) => peer.sessionId === notificationSessionId)) {
    return 'discard'
  }
  if (focused.length > 0) {
    return focused.some((peer) => peer.tabId === ownTabId) ? 'toast' : 'none'
  }

  const leader = [...peers].sort(
    (a, b) => a.startedAt - b.startedAt || a.tabId.localeCompare(b.tabId),
  )[0]
  return leader?.tabId === ownTabId ? 'desktop' : 'none'
}
