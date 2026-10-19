import {
  registerNotificationWorker,
  supportsDesktopNotifications,
} from '@/lib/notification-desktop'
import {
  acknowledgeWorkerAction,
  drainPendingWorkerActions,
  isWorkerAction,
} from '@/lib/notification-worker-actions'
import { toastError } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { NotificationWorkerAction } from '@sb/core/notification-actions'
import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { useCallback, useEffect } from 'react'
import { useLocation } from 'wouter'

/** Replays durable desktop clicks independently of whether delivery is enabled. */
export function useNotificationWorker() {
  const markManyRead = useMutation(api.notifications.markManyRead)
  const respond = useMutation(api.notifications.respondApproval)
  const [, navigate] = useLocation()

  const apply = useCallback(
    async (action: NotificationWorkerAction) => {
      try {
        if (action.action === 'read' || action.action === 'show') {
          await markManyRead({
            notificationIds: [action.notificationId as Id<'notifications'>],
          })
          if (action.action === 'show' && action.sessionId) {
            navigate(`/?id=${action.sessionId}`)
            window.focus()
          }
        } else {
          await respond({
            notificationId: action.notificationId as Id<'notifications'>,
            action: action.action,
          })
        }
      } catch (error) {
        const code = error instanceof ConvexError ? error.data?.code : undefined
        if (![403, 404, 409].includes(code)) throw error
        toastError(error)
      }
      acknowledgeWorkerAction(action)
    },
    [markManyRead, navigate, respond],
  )

  useEffect(() => {
    if (!supportsDesktopNotifications()) return

    const onMessage = (event: MessageEvent<unknown>) => {
      if (isWorkerAction(event.data)) void apply(event.data).catch(toastError)
    }
    const drain = () => {
      void registerNotificationWorker()
        .then(() => drainPendingWorkerActions(apply))
        .catch(toastError)
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    window.addEventListener('focus', drain)
    drain()

    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      window.removeEventListener('focus', drain)
    }
  }, [apply])
}
