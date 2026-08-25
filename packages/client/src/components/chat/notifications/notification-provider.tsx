import { RippleButton } from '@/components/ui'
import { useActiveSessionId } from '@/hooks/chat'
import { createUsableContext } from '@/hooks/context'
import {
  type NotificationItem,
  notificationBody,
  notificationTag,
  notificationToastId,
} from '@/lib/chat/notification-ui'
import { updateNotificationFavicon } from '@/lib/notification-favicon'
import {
  type NotificationPeer,
  type NotificationSurface,
  chooseNotificationSurface,
} from '@/lib/notification-presence'
import { toast } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import { MAX_READ_NOTIFICATIONS } from '@sb/core/limits'
import type { OptimisticLocalStore } from 'convex/browser'
import { useMutation, useQuery } from 'convex/react'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation } from 'wouter'

import { NotificationAvatar } from './notification-avatar'

type DesktopPermission = NotificationPermission | 'unsupported'

type NotificationContextValue = {
  unread: NotificationItem[]
  read: NotificationItem[]
  desktopPermission: DesktopPermission
  openSession: (notification: NotificationItem) => void
  show: (notification: NotificationItem) => void
  markRead: (notification: NotificationItem) => void
  markAllRead: () => void
  clearRead: () => void
  enableDesktop: () => Promise<void>
}

const [NotificationContext, useNotifications] =
  createUsableContext<NotificationContextValue>('Notifications')

export { useNotifications }

/** Returns the session IDs represented in the current unread inbox. */
export function useUnreadNotificationSessionIds() {
  const { unread } = useNotifications()
  return useMemo(
    () => new Set<string>(unread.map((notification) => notification.sessionId)),
    [unread],
  )
}

/** Coordinates inbox state and contextual delivery across browser tabs. */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const unreadResult = useQuery(api.notifications.list, { status: 'unread' })
  const readResult = useQuery(api.notifications.list, { status: 'read' })
  const unread = useMemo(() => unreadResult ?? [], [unreadResult])
  const read = useMemo(() => readResult ?? [], [readResult])
  const activeSessionId = useActiveSessionId()
  const [, navigate] = useLocation()
  const markReadMutation = useMutation(
    api.notifications.markRead,
  ).withOptimisticUpdate(optimisticallyMarkNotificationRead)
  const markManyRead = useMutation(api.notifications.markManyRead)
  const markAllReadMutation = useMutation(api.notifications.markAllRead)
  const markSessionRead = useMutation(api.notifications.markSessionRead)
  const discardSession = useMutation(api.notifications.discardSession)
  const clearReadMutation = useMutation(api.notifications.clearRead)
  const [desktopPermission, setDesktopPermission] = useState<DesktopPermission>(
    readDesktopPermission,
  )
  // A null baseline prevents replaying the startup backlog as new alerts
  const knownUnread = useRef<Set<string> | null>(null)
  // Tracks surfaced alerts so read transitions can close their UI
  const surfaced = useRef(new Set<string>())
  const presence = useTabPresence(activeSessionId)

  const markRead = useCallback(
    (notification: NotificationItem) => {
      void markReadMutation({ notificationId: notification._id })
    },
    [markReadMutation],
  )

  const openSession = useCallback(
    (notification: NotificationItem) => {
      navigate(`/?id=${notification.sessionId}`, { replace: true })
      if (notification.status === 'unread') {
        // Let the destination render before starting notification bookkeeping
        window.setTimeout(() => markRead(notification), 0)
      }
    },
    [markRead, navigate],
  )

  const show = useCallback(
    (notification: NotificationItem) => {
      openSession(notification)
      window.focus()
    },
    [openSession],
  )

  const markAll = useCallback(() => {
    void markAllReadMutation({})
  }, [markAllReadMutation])

  const clearRead = useCallback(() => {
    void clearReadMutation({})
  }, [clearReadMutation])

  const enableDesktop = useCallback(async () => {
    if (!supportsDesktopNotifications()) {
      setDesktopPermission('unsupported')
      return
    }
    await registerNotificationWorker()
    const permission = await Notification.requestPermission()
    setDesktopPermission(permission)
  }, [])

  useEffect(() => {
    updateNotificationFavicon(unread.length)
  }, [unread.length])

  useEffect(() => {
    if (!supportsDesktopNotifications()) return
    void registerNotificationWorker()
    const onMessage = (event: MessageEvent<WorkerAction>) => {
      if (event.data?.type !== 'slopbench:notification-action') return
      if (event.data.notificationId) {
        void markManyRead({
          notificationIds: [event.data.notificationId as Id<'notifications'>],
        })
      }
      if (event.data.action === 'show' && event.data.sessionId) {
        navigate(`/?id=${event.data.sessionId}`)
        window.focus()
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    void drainPendingWorkerActions(markManyRead)
    return () =>
      navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [markManyRead, navigate])

  useEffect(() => {
    if (!activeSessionId) return
    const markCurrentSession = () => {
      if (!pageIsFocused()) return
      void markSessionRead({
        sessionId: activeSessionId as Id<'sessions'>,
      })
    }
    markCurrentSession()
    window.addEventListener('focus', markCurrentSession)
    document.addEventListener('visibilitychange', markCurrentSession)
    return () => {
      window.removeEventListener('focus', markCurrentSession)
      document.removeEventListener('visibilitychange', markCurrentSession)
    }
  }, [activeSessionId, markSessionRead])

  useEffect(() => {
    if (unreadResult === undefined) return
    const currentIds = new Set(unread.map((item) => item._id))
    const previous = knownUnread.current
    knownUnread.current = currentIds

    if (previous === null) return
    const added = unread.filter((item) => !previous.has(item._id))
    for (const notification of added) {
      void presence.decide(notification.sessionId).then((decision) => {
        if (decision === 'discard') {
          void discardSession({ sessionId: notification.sessionId })
          return
        }
        if (decision === 'toast') {
          surfaced.current.add(notification._id)
          showNotificationToast(notification, show, markRead)
          return
        }
        if (decision === 'desktop') {
          surfaced.current.add(notification._id)
          void showDesktopNotification(notification)
        }
      })
    }
  }, [discardSession, markRead, presence, show, unread, unreadResult])

  useEffect(() => {
    const unreadIds = new Set(unread.map((item) => item._id))
    for (const notificationId of surfaced.current) {
      if (unreadIds.has(notificationId as Id<'notifications'>)) continue
      toast.dismiss(notificationToastId(notificationId))
      void closeDesktopNotification(notificationId)
      surfaced.current.delete(notificationId)
    }
  }, [unread])

  return (
    <NotificationContext.Provider
      value={{
        unread,
        read,
        desktopPermission,
        openSession,
        show,
        markRead,
        markAllRead: markAll,
        clearRead,
        enableDesktop,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

/** Moves one notification between the subscribed inbox lists immediately. */
function optimisticallyMarkNotificationRead(
  store: OptimisticLocalStore,
  { notificationId }: { notificationId: Id<'notifications'> },
) {
  const unreadArgs = { status: 'unread' as const }
  const unread = store.getQuery(api.notifications.list, unreadArgs)
  const notification = unread?.find((item) => item._id === notificationId)
  if (!unread || !notification) return

  store.setQuery(
    api.notifications.list,
    unreadArgs,
    unread.filter((item) => item._id !== notificationId),
  )

  const readArgs = { status: 'read' as const }
  const read = store.getQuery(api.notifications.list, readArgs)
  if (!read) return

  const readNotification: Doc<'notifications'> = {
    ...notification,
    status: 'read',
    readAt: Date.now(),
  }
  store.setQuery(
    api.notifications.list,
    readArgs,
    [readNotification, ...read].slice(0, MAX_READ_NOTIFICATIONS),
  )
}

function NotificationToast({
  notification,
  onShow,
  onRead,
}: {
  notification: NotificationItem
  onShow: () => void
  onRead: () => void
}) {
  return (
    <div className="bg-popover text-popover-foreground ring-foreground/10 flex w-88 gap-3 rounded-xl p-3 shadow-md ring-1">
      <NotificationAvatar notification={notification} className="size-9" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{notification.actorName}</div>
        <div className="line-clamp-2 text-sm">
          {notificationBody(notification)}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {notification.sessionTitle}
        </div>
        <div className="mt-2 flex justify-end gap-1">
          <RippleButton variant="stealth" size="sm" onClick={onRead}>
            Dismiss
          </RippleButton>
          <RippleButton variant="primary" size="sm" onClick={onShow}>
            Show
          </RippleButton>
        </div>
      </div>
    </div>
  )
}

/** Shows an in-app notification without changing read state. */
function showNotificationToast(
  notification: NotificationItem,
  show: (notification: NotificationItem) => void,
  markRead: (notification: NotificationItem) => void,
) {
  const id = notificationToastId(notification._id)
  toast.custom(
    () => (
      <NotificationToast
        notification={notification}
        onShow={() => {
          show(notification)
          toast.dismiss(id)
        }}
        onRead={() => {
          markRead(notification)
          toast.dismiss(id)
        }}
      />
    ),
    { id },
  )
}

/** Shows a native notification when browser permission allows it. */
async function showDesktopNotification(notification: NotificationItem) {
  if (
    !supportsDesktopNotifications() ||
    Notification.permission !== 'granted'
  ) {
    return
  }
  const registration = await registerNotificationWorker()
  const options: NotificationOptions & {
    actions: Array<{ action: string; title: string }>
  } = {
    body: notificationBody(notification),
    icon: '/favicon.svg',
    tag: notificationTag(notification._id),
    data: {
      notificationId: notification._id,
      sessionId: notification.sessionId,
    },
    actions: [{ action: 'dismiss', title: 'Dismiss' }],
  }
  await registration.showNotification(notification.actorName, options)
}

/** Closes the native alert associated with a notification record. */
async function closeDesktopNotification(notificationId: string) {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  const notifications = await registration?.getNotifications({
    tag: notificationTag(notificationId),
  })
  notifications?.forEach((notification) => notification.close())
}

/** Reuses the root-scoped service worker registration within this page. */
let workerRegistration: Promise<ServiceWorkerRegistration> | null = null

/** Registers the worker that handles native notification actions. */
function registerNotificationWorker() {
  workerRegistration ??= navigator.serviceWorker.register(
    '/notification-worker.js',
  )
  return workerRegistration
}

function supportsDesktopNotifications() {
  return (
    window.isSecureContext &&
    'Notification' in window &&
    'serviceWorker' in navigator
  )
}

function readDesktopPermission(): DesktopPermission {
  return supportsDesktopNotifications()
    ? Notification.permission
    : 'unsupported'
}

/** Must match the service worker's cache for actions received without a page. */
const ACTION_CACHE = 'slopbench-notification-actions-v1'

type MarkManyRead = ReturnType<
  typeof useMutation<typeof api.notifications.markManyRead>
>

/** Applies service worker actions queued while every app tab was closed. */
async function drainPendingWorkerActions(markManyRead: MarkManyRead) {
  if (!('caches' in window)) return
  const cache = await caches.open(ACTION_CACHE)
  const keys = await cache.keys()
  const notificationIds = keys.flatMap((request) => {
    const marker = '/__notification_actions__/'
    const index = request.url.indexOf(marker)
    return index === -1
      ? []
      : [decodeURIComponent(request.url.slice(index + marker.length))]
  })
  if (notificationIds.length === 0) return
  await markManyRead({
    notificationIds: notificationIds as Id<'notifications'>[],
  })
  await Promise.all(keys.map((request) => cache.delete(request)))
}

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
function useTabPresence(activeSessionId: string | null) {
  const [tabId] = useState(() => crypto.randomUUID())
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

/** True only when the page is both visible and the active browser surface. */
function pageIsFocused() {
  return document.visibilityState === 'visible' && document.hasFocus()
}

type WorkerAction = {
  type: 'slopbench:notification-action'
  action?: 'read' | 'show'
  notificationId?: string
  sessionId?: string
}
