import type { api } from '@sb/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'

export type NotificationItem = FunctionReturnType<
  typeof api.notifications.list
>[number]

/** Formats the body shared by toast and desktop surfaces. */
export function notificationBody(notification: NotificationItem): string {
  switch (notification.kind) {
    case 'approval_required':
      return notification.preview || 'Approval required'
    case 'input_required':
      return (notification.preview || `${notification.actorName} has questions for you`) // prettier-ignore
    case 'turn_error':
      return `${notification.actorName}'s turn ended with an error`
    case 'turn_completed':
      return notification.preview || 'Turn completed'
    case 'user_message':
      return notification.preview || 'Sent a message'
  }
}

/** Returns the stable Sonner identifier for one notification. */
export function notificationToastId(notificationId: string) {
  return `notification:${notificationId}`
}

/** Returns the stable native notification tag for one notification. */
export function notificationTag(notificationId: string) {
  return `slopbench:${notificationId}`
}

/** Identifies requests that must survive ordinary notification bookkeeping. */
export function isPendingNotification(notification: NotificationItem) {
  return notification.requestState === 'pending'
}

export function notificationRequestLabel(notification: NotificationItem) {
  if (notification.requestState === 'expired') return 'Expired'
  if (!isPendingNotification(notification)) return undefined
  return notification.kind === 'approval_required'
    ? 'Approval needed'
    : 'Answer needed'
}
