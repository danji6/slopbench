import { showNotificationToast } from '@/components/chat/notifications/notification-toast'
import {
  type NotificationItem,
  isPendingNotification,
  notificationToastId,
} from '@/lib/chat/notification-ui'
import {
  closeAllDesktopNotifications,
  closeInactiveDesktopNotifications,
  showDesktopNotificationOnce,
} from '@/lib/notification-desktop'
import { toast, toastError } from '@/lib/notifications'
import { APP_ID } from '@sb/core/const'
import type { NotificationApprovalAction } from '@sb/core/notification-actions'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useTabPresence } from './notification-presence'

type DeliveryOptions = {
  unread: NotificationItem[] | undefined
  recent: NotificationItem[] | undefined
  activeIds: string[] | undefined
  activeSessionId: string | null
  desktopReady: boolean
  desktopEnabled: boolean
  show: (notification: NotificationItem) => void
  markRead: (notification: NotificationItem) => void
  respond: (
    notification: NotificationItem,
    action: NotificationApprovalAction,
  ) => Promise<void>
  openInbox: () => void
  discardSession: (sessionId: string) => void
}

type StackPreference = { minimized: boolean; seen: string[] }
const STACK_KEY = `${APP_ID}:notification-stack`

function readStackPreference(): StackPreference {
  try {
    const value = JSON.parse(sessionStorage.getItem(STACK_KEY) ?? 'null')
    if (
      value &&
      typeof value.minimized === 'boolean' &&
      Array.isArray(value.seen)
    )
      return value
    return { minimized: false, seen: [] }
  } catch {
    return { minimized: false, seen: [] }
  }
}

/** Projects the queue into Sonner without treating dismissal as resolution. */
export function useNotificationDelivery(options: DeliveryOptions) {
  const presence = useTabPresence(options.activeSessionId)
  const { decide } = presence
  const [stack, setStack] = useState(readStackPreference)
  const known = useRef<Set<string> | null>(null)
  const startupBoundary = useRef(0)
  const surfaced = useRef(new Map<string, NotificationItem>())
  const delivery = useRef(Promise.resolve())

  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  const minimized =
    stack.minimized &&
    Boolean(options.recent?.length) &&
    options.recent!.every((item) => stack.seen.includes(item._id))

  const minimize = useCallback(
    () =>
      setStack({
        minimized: true,
        seen: latest.current.activeIds ?? [],
      }),
    [],
  )

  useEffect(() => {
    if (!options.recent) return
    try {
      sessionStorage.setItem(
        STACK_KEY,
        JSON.stringify({
          minimized,
          seen: options.activeIds ?? [],
        }),
      )
    } catch {
      /* Queue durability does not depend on browser storage. */
    }
  }, [minimized, options.recent, options.activeIds])

  useEffect(() => {
    if (options.activeIds)
      void closeInactiveDesktopNotifications(options.activeIds).catch(
        toastError,
      )
  }, [options.activeIds])

  useEffect(() => {
    if (options.desktopReady && !options.desktopEnabled)
      void closeAllDesktopNotifications().catch(toastError)
  }, [options.desktopEnabled, options.desktopReady])

  useEffect(() => {
    if (!options.recent || !options.unread) return
    const items = [...options.unread, ...options.recent]

    const previous = known.current
    if (!previous) {
      known.current = new Set(items.map((item) => item._id))
      startupBoundary.current = Math.max(
        0,
        ...items.map((item) => item._creationTime),
      )
      return
    }

    const added = items
      .filter(
        (item) =>
          !previous.has(item._id) &&
          item._creationTime >= startupBoundary.current,
      )
      .sort(
        (a, b) =>
          a._creationTime - b._creationTime || a._id.localeCompare(b._id),
      )

    for (const item of items) {
      previous.add(item._id)
    }
    for (const item of added) {
      delivery.current = delivery.current
        .then(async () => {
          const current = latest.current
          const exists = [
            ...(current.unread ?? []),
            ...(current.recent ?? []),
          ].some((candidate) => candidate._id === item._id)
          if (!exists) return

          const important = isPendingNotification(item)
          const surface = await decide(item.sessionId, important)

          if (surface === 'discard') {
            current.discardSession(item.sessionId)
          }
          if (surface === 'toast' && !important) {
            showNotificationToast(
              item,
              current.show,
              current.markRead,
              current.respond,
            )
          }
          if (surface === 'desktop' && current.desktopEnabled) {
            await showDesktopNotificationOnce(
              item,
              () =>
                latest.current.desktopEnabled &&
                [
                  ...(latest.current.unread ?? []),
                  ...(latest.current.recent ?? []),
                ].some((candidate) => candidate._id === item._id),
            )
          }
        })
        .catch(toastError)
    }
  }, [options.unread, options.recent, decide])

  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      const current = latest.current
      const surface = await decide('', true)
      if (cancelled) return

      const candidates =
        !minimized && surface === 'toast'
          ? (current.recent ?? []).slice(0, 3)
          : []

      const ids = new Set<string>(candidates.map((item) => item._id))
      for (const id of surfaced.current.keys()) {
        if (!ids.has(id)) {
          toast.dismiss(notificationToastId(id))
          surfaced.current.delete(id)
        }
      }

      for (const item of [...candidates].reverse()) {
        if (
          JSON.stringify(surfaced.current.get(item._id)) ===
          JSON.stringify(item)
        )
          continue
        surfaced.current.set(item._id, item)
        showNotificationToast(
          item,
          current.show,
          current.markRead,
          current.respond,
          { minimize, openInbox: current.openInbox },
        )
      }
    }

    void sync().catch(toastError)

    return () => {
      cancelled = true
    }
  }, [options.recent, options.unread, presence, minimized, minimize, decide])

  useEffect(
    () => () => {
      for (const id of surfaced.current.keys())
        toast.dismiss(notificationToastId(id))
      surfaced.current.clear()
    },
    [],
  )
}
