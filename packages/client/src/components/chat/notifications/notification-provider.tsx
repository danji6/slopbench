import { useActiveSessionId } from '@/hooks/chat'
import { createUsableContext } from '@/hooks/context'
import { useTabPresence } from '@/hooks/notification-presence'
import {
  type NotificationItem,
  notificationToastId,
} from '@/lib/chat/notification-ui'
import {
  closeDesktopNotification,
  registerNotificationWorker,
  showDesktopNotification,
  supportsDesktopNotifications,
} from '@/lib/notification-desktop'
import { updateNotificationFavicon } from '@/lib/notification-favicon'
import { pageIsFocused } from '@/lib/notification-presence'
import {
  acknowledgeWorkerAction,
  drainPendingWorkerActions,
  isWorkerAction,
} from '@/lib/notification-worker-actions'
import { toast, toastError } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { MAX_READ_NOTIFICATIONS } from '@sb/core/limits'
import type {
  NotificationApprovalAction,
  NotificationWorkerAction,
} from '@sb/core/notification-actions'
import type { OptimisticLocalStore } from 'convex/browser'
import { useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation } from 'wouter'

import { showNotificationToast } from './notification-toast'

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
  respondApproval: (
    notification: NotificationItem,
    action: NotificationApprovalAction,
  ) => Promise<void>
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
  const respondApprovalMutation = useMutation(api.notifications.respondApproval)
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
  const surfaced = useRef(
    new Map<string, { surface: 'toast' | 'desktop'; actions: string }>(),
  )

  const latestUnread = useRef(unread)
  useEffect(() => {
    latestUnread.current = unread
  }, [unread])

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

  const respondApproval = useCallback(
    async (
      notification: NotificationItem,
      action: NotificationApprovalAction,
    ) => {
      try {
        const status = await respondApprovalMutation({
          notificationId: notification._id,
          action,
        })
        if (status === 'stale')
          toast.info('This approval is no longer pending.')
      } catch (error) {
        toastError(error)
        throw error
      }
    },
    [respondApprovalMutation],
  )

  const applyWorkerAction = useCallback(
    async (action: NotificationWorkerAction) => {
      if (action.action === 'read' || action.action === 'show') {
        await markManyRead({
          notificationIds: [action.notificationId as Id<'notifications'>],
        })
        if (action.action === 'show' && action.sessionId) {
          navigate(`/?id=${action.sessionId}`)
          window.focus()
        }
      } else {
        try {
          await respondApprovalMutation({
            notificationId: action.notificationId as Id<'notifications'>,
            action: action.action,
          })
        } catch (error) {
          const code =
            error instanceof ConvexError ? error.data?.code : undefined
          if (![403, 404, 409].includes(code)) throw error
          // Deleted requests or lost permissions cannot be retried by this account
          toastError(error)
        }
      }
      acknowledgeWorkerAction(action)
    },
    [markManyRead, navigate, respondApprovalMutation],
  )

  useEffect(() => {
    if (!supportsDesktopNotifications()) return
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isWorkerAction(event.data)) return
      void applyWorkerAction(event.data).catch(toastError)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    const drain = () => {
      void registerNotificationWorker()
        .then(() => drainPendingWorkerActions(applyWorkerAction))
        .catch(toastError)
    }
    drain()
    window.addEventListener('focus', drain)
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      window.removeEventListener('focus', drain)
    }
  }, [applyWorkerAction])

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
    for (const addedNotification of added) {
      void presence.decide(addedNotification.sessionId).then((decision) => {
        const notification = latestUnread.current.find(
          (item) => item._id === addedNotification._id,
        )
        if (!notification) return
        if (notification.approval && !notification.approvalPending) return
        if (decision === 'discard') {
          void discardSession({ sessionId: notification.sessionId })
          return
        }
        if (decision === 'toast') {
          surfaced.current.set(notification._id, {
            surface: 'toast',
            actions: JSON.stringify(notification.approvalActions),
          })
          showNotificationToast(notification, show, markRead, respondApproval)
          return
        }
        if (decision === 'desktop') {
          surfaced.current.set(notification._id, {
            surface: 'desktop',
            actions: JSON.stringify(notification.approvalActions),
          })
          void showDesktopNotification(notification, () =>
            latestUnread.current.some(
              (item) =>
                item._id === notification._id &&
                (!item.approval || item.approvalPending),
            ),
          ).catch(toastError)
        }
      })
    }
  }, [
    discardSession,
    markRead,
    presence,
    respondApproval,
    show,
    unread,
    unreadResult,
  ])

  useEffect(() => {
    for (const [notificationId, surface] of surfaced.current) {
      const notification = unread.find((item) => item._id === notificationId)
      const pending =
        notification && (!notification.approval || notification.approvalPending)
      if (pending) {
        const actions = JSON.stringify(notification.approvalActions)
        if (surface.actions !== actions) {
          surfaced.current.set(notificationId, { ...surface, actions })
          if (surface.surface === 'toast')
            showNotificationToast(notification, show, markRead, respondApproval)
          else void showDesktopNotification(notification).catch(toastError)
        }
        continue
      }
      toast.dismiss(notificationToastId(notificationId))
      void closeDesktopNotification(notificationId)
      surfaced.current.delete(notificationId)
    }
  }, [unread, markRead, respondApproval, show])

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
        respondApproval,
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

  const readNotification: NotificationItem = {
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

function readDesktopPermission(): DesktopPermission {
  return supportsDesktopNotifications()
    ? Notification.permission
    : 'unsupported'
}
