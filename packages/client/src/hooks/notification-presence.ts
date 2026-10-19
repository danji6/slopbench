import {
  type NotificationPeer,
  type NotificationSurface,
  chooseNotificationSurface,
  pageIsFocused,
} from '@/lib/notification-presence'
import { generateId } from '@/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type PresenceMessage = {
  type: 'presence' | 'probe' | 'leave'
  tabId: string
  startedAt: number
  focused: boolean
  sessionId: string | null
  at: number
}

type Peer = Omit<PresenceMessage, 'type'>

/** Tracks live same origin tabs and arbitrates which one surfaces each alert. */
export function useTabPresence(activeSessionId: string | null) {
  const [tabId] = useState(generateId)
  const [startedAt] = useState(Date.now)
  const peers = useRef(new Map<string, Peer>())
  const channel = useRef<BroadcastChannel | null>(null)
  const sessionRef = useRef(activeSessionId)

  useEffect(() => {
    sessionRef.current = activeSessionId
  }, [activeSessionId])

  const announce = useCallback(
    (type: PresenceMessage['type'] = 'presence') => {
      channel.current?.postMessage({
        type,
        tabId,
        startedAt,
        focused: pageIsFocused(),
        sessionId: sessionRef.current,
        at: Date.now(),
      } satisfies PresenceMessage)
    },
    [startedAt, tabId],
  )

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return

    const next = new BroadcastChannel('slopbench-notification-presence')
    channel.current = next

    next.onmessage = (event: MessageEvent<PresenceMessage>) => {
      const message = event.data
      if (!message || message.tabId === tabId) return
      if (message.type === 'leave') peers.current.delete(message.tabId)
      else peers.current.set(message.tabId, message)
      if (message.type === 'probe') announce()
    }

    announce()
    const interval = window.setInterval(announce, 4_000)
    const onState = () => announce()
    const onUnload = () => announce('leave')

    window.addEventListener('focus', onState)
    window.addEventListener('blur', onState)
    window.addEventListener('pagehide', onUnload)
    document.addEventListener('visibilitychange', onState)

    return () => {
      announce('leave')
      window.clearInterval(interval)
      window.removeEventListener('focus', onState)
      window.removeEventListener('blur', onState)
      window.removeEventListener('pagehide', onUnload)
      document.removeEventListener('visibilitychange', onState)
      next.close()
      channel.current = null
    }
  }, [announce, tabId])

  useEffect(() => announce(), [activeSessionId, announce])

  const decide = useCallback(
    async (sessionId: string): Promise<NotificationSurface> => {
      announce('probe')
      // Give peer tabs a brief window to answer the probe
      await new Promise((resolve) => window.setTimeout(resolve, 75))
      const now = Date.now()
      const own: Peer = {
        tabId,
        startedAt,
        focused: pageIsFocused(),
        sessionId: sessionRef.current,
        at: now,
      }
      const live: NotificationPeer[] = [
        own,
        ...[...peers.current.values()].filter((peer) => now - peer.at < 10_000),
      ]
      return chooseNotificationSurface(live, own.tabId, sessionId)
    },
    [announce, startedAt, tabId],
  )

  return useMemo(() => ({ decide }), [decide])
}
