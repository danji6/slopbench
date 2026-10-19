import { useActiveSessionId } from '@/hooks/chat'
import { createUsableContext } from '@/hooks/context'
import { useNotificationDelivery } from '@/hooks/notification-delivery'
import { useNotificationPreferences } from '@/hooks/notification-preferences'
import { useNotificationWorker } from '@/hooks/notification-worker'
import {
  type NotificationItem,
  isPendingNotification,
} from '@/lib/chat/notification-ui'
import { updateNotificationFavicon } from '@/lib/notification-favicon'
import { pageIsFocused } from '@/lib/notification-presence'
import { toast, toastError } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { NotificationApprovalAction } from '@sb/core/notification-actions'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useLocation } from 'wouter'

type NotificationContextValue = ReturnType<typeof useNotificationState>
const [NotificationContext, useNotifications] =
  createUsableContext<NotificationContextValue>('Notifications')
export { useNotifications }

/** Returns the session IDs represented by unread activity or pending requests. */
export function useUnreadNotificationSessionIds() {
  const { unread } = useNotifications()
  return useMemo(
    () => new Set<string>(unread.map((item) => item.sessionId)),
    [unread],
  )
}

/** Coordinates reactive inbox data, request responses, and notification surfaces. */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const value = useNotificationState()
  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}

function useNotificationState() {
  const unreadResult = useQuery(api.notifications.list, { status: 'unread' })
  const read = useQuery(api.notifications.list, { status: 'read' }) ?? []
  const summary = useQuery(api.notifications.summary, {})

  const pending = usePaginatedQuery(
    api.notifications.pendingPage,
    { state: 'pending' },
    { initialNumItems: 25 },
  )

  const expired = usePaginatedQuery(
    api.notifications.pendingPage,
    { state: 'expired' },
    { initialNumItems: 25 },
  )

  const unread = useMemo(
    () => [...pending.results, ...expired.results, ...(unreadResult ?? [])],
    [pending.results, expired.results, unreadResult],
  )

  const preferences = useNotificationPreferences()
  const activeSessionId = useActiveSessionId()
  const [, navigate] = useLocation()
  const [inboxOpen, updateInboxOpen] = useState(false)
  const [inboxTab, setInboxTab] = useState('unread')

  const setInboxOpen = useCallback((value: boolean) => {
    if (value) setInboxTab('unread')
    updateInboxOpen(value)
  }, [])

  const markReadMutation = useMutation(api.notifications.markRead)
  const acknowledgeMutation = useMutation(api.notifications.acknowledge)
  const respondMutation = useMutation(api.notifications.respondApproval)
  const markAllReadMutation = useMutation(api.notifications.markAllRead)
  const markSessionRead = useMutation(api.notifications.markSessionRead)
  const discard = useMutation(api.notifications.discardSession)
  const clearReadMutation = useMutation(api.notifications.clearRead)

  useNotificationWorker()

  const markRead = useCallback(
    (notification: NotificationItem) => {
      if (isPendingNotification(notification)) return
      const mutation =
        notification.requestState === 'expired'
          ? acknowledgeMutation
          : markReadMutation
      void mutation({ notificationId: notification._id }).catch(toastError)
    },
    [acknowledgeMutation, markReadMutation],
  )

  const openSession = useCallback(
    (notification: NotificationItem) => {
      navigate(`/?id=${notification.sessionId}`, { replace: true })
      if (!notification.attention) markRead(notification)
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

  const openInbox = useCallback(() => setInboxOpen(true), [setInboxOpen])

  const discardSession = useCallback(
    (sessionId: string) => {
      void discard({ sessionId: sessionId as Id<'sessions'> }).catch(toastError)
    },
    [discard],
  )

  const respondApproval = useCallback(
    async (
      notification: NotificationItem,
      action: NotificationApprovalAction,
    ) => {
      try {
        const status = await respondMutation({
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
    [respondMutation],
  )

  useNotificationDelivery({
    unread: unreadResult,
    recent: summary?.recent,
    activeIds: summary?.activeIds,
    activeSessionId,
    desktopReady: preferences.desktopReady,
    desktopEnabled: preferences.desktopEnabled,
    show,
    markRead,
    respond: respondApproval,
    openInbox,
    discardSession,
  })

  useEffect(() => {
    updateNotificationFavicon(summary?.unreadCount ?? 0)
  }, [summary?.unreadCount])

  useEffect(() => {
    if (!activeSessionId) return
    const markCurrent = () => {
      if (pageIsFocused())
        void markSessionRead({
          sessionId: activeSessionId as Id<'sessions'>,
        }).catch(toastError)
    }

    markCurrent()
    window.addEventListener('focus', markCurrent)
    document.addEventListener('visibilitychange', markCurrent)

    return () => {
      window.removeEventListener('focus', markCurrent)
      document.removeEventListener('visibilitychange', markCurrent)
    }
  }, [activeSessionId, markSessionRead])

  return {
    unread,
    read,
    unreadCount: summary?.unreadCount ?? 0,
    pendingCount: summary?.pendingCount ?? 0,
    inboxOpen,
    setInboxOpen,
    inboxTab,
    setInboxTab,
    ...preferences,
    openSession,
    show,
    markRead,
    respondApproval,
    markAllRead: () => {
      void markAllReadMutation({}).catch(toastError)
    },
    clearRead: () => {
      void clearReadMutation({}).catch(toastError)
    },
    canLoadMore:
      pending.status === 'CanLoadMore' || expired.status === 'CanLoadMore',
    loadMore: () => {
      if (pending.status === 'CanLoadMore') pending.loadMore(25)
      else if (expired.status === 'CanLoadMore') expired.loadMore(25)
    },
  }
}
