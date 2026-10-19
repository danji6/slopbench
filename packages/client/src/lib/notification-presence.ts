export type NotificationSurface = 'discard' | 'toast' | 'desktop' | 'none'

export type NotificationPeer = {
  tabId: string
  startedAt: number
  focused: boolean
  focusedAt?: number
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
    const leader = focused.sort(
      (a, b) =>
        (b.focusedAt ?? b.startedAt) - (a.focusedAt ?? a.startedAt) ||
        a.tabId.localeCompare(b.tabId),
    )[0]
    return leader?.tabId === ownTabId ? 'toast' : 'none'
  }

  const leader = [...peers].sort(
    (a, b) => a.startedAt - b.startedAt || a.tabId.localeCompare(b.tabId),
  )[0]
  return leader?.tabId === ownTabId ? 'desktop' : 'none'
}

/** True only when the page is both visible and the active browser surface. */
export function pageIsFocused() {
  return document.visibilityState === 'visible' && document.hasFocus()
}
