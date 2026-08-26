import type { Doc } from '@sb/convex/_generated/dataModel'

export type NotificationItem = Doc<'notifications'>

/** Formats the body shared by toast and desktop surfaces. */
export function notificationBody(notification: NotificationItem): string {
  switch (notification.kind) {
    case 'approval_required':
      return `${notification.actorName} needs your attention`
    case 'input_required':
      return `${notification.actorName} has questions for you`
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
