import {
  type NotificationItem,
  notificationBody,
  notificationTag,
} from '@/lib/chat/notification-ui'
import { desktopApprovalActions } from '@sb/core/notification-actions'

/** Shows a native notification when browser permission allows it. */
export async function showDesktopNotification(
  notification: NotificationItem,
  isCurrent = () => true,
) {
  if (!supportsDesktopNotifications() || Notification.permission !== 'granted')
    return

  const registration = await registerNotificationWorker()
  if (!isCurrent()) return

  const maxActions =
    (Notification as typeof Notification & { maxActions?: number })
      .maxActions ?? 2

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
    actions: notification.approvalActions?.length
      ? desktopApprovalActions(notification.approvalActions, maxActions)
      : [{ action: 'dismiss', title: 'Dismiss' }],
  }

  await registration.showNotification(notification.actorName, options)
}

/** Closes the native alert associated with a notification record. */
export async function closeDesktopNotification(notificationId: string) {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  const notifications = await registration?.getNotifications({
    tag: notificationTag(notificationId),
  })
  notifications?.forEach((notification) => notification.close())
}

let workerRegistration: Promise<ServiceWorkerRegistration> | null = null

/** Registers the worker that handles native notification actions. */
export function registerNotificationWorker() {
  workerRegistration ??= navigator.serviceWorker.register(
    '/notification-worker.js',
  )
  return workerRegistration
}

export function supportsDesktopNotifications() {
  return (
    window.isSecureContext &&
    'Notification' in window &&
    'serviceWorker' in navigator
  )
}
