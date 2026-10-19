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
    requireInteraction: notification.requestState === 'pending',
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
  return true
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
  workerRegistration ??= navigator.serviceWorker
    .register('/notification-worker.js')
    .catch((error) => {
      workerRegistration = null
      throw error
    })
  return workerRegistration
}

export function supportsDesktopNotifications() {
  return (
    window.isSecureContext &&
    'Notification' in window &&
    'serviceWorker' in navigator
  )
}

const DELIVERY_KEY = 'slopbench:desktop-delivery'

function deliveredNotifications(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(DELIVERY_KEY) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {}
  } catch {
    return {}
  }
}

/** Suppresses replay across reloads and serializes delivery between browser tabs. */
export async function showDesktopNotificationOnce(
  notification: NotificationItem,
  isCurrent: () => boolean,
) {
  const deliver = async () => {
    const delivered = deliveredNotifications()
    if (delivered[notification._id]) return
    if (!(await showDesktopNotification(notification, isCurrent))) return
    delivered[notification._id] = Date.now()
    const bounded = Object.fromEntries(
      Object.entries(delivered)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 1000),
    )
    try {
      localStorage.setItem(DELIVERY_KEY, JSON.stringify(bounded))
    } catch {
      /* Desktop deduplication is best effort; requests remain on the server. */
    }
  }
  if (navigator.locks) await navigator.locks.request(DELIVERY_KEY, deliver)
  else await deliver()
}

/** Closes settled banners even when another tab originally delivered them. */
export async function closeInactiveDesktopNotifications(activeIds: string[]) {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  const notifications = await registration?.getNotifications()
  const active = new Set(activeIds)
  for (const notification of notifications ?? []) {
    if (!notification.tag.startsWith('slopbench:')) continue
    const id = notification.data?.notificationId
    if (typeof id === 'string' && !active.has(id)) notification.close()
  }
}

/** Closes delivered banners when the user disables desktop delivery. */
export async function closeAllDesktopNotifications() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  const notifications = await registration?.getNotifications()
  notifications
    ?.filter((notification) => notification.tag.startsWith('slopbench:'))
    .forEach((notification) => notification.close())
}
