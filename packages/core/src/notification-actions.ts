import { APP_ID } from './const'

export const NOTIFICATION_ACTION = `${APP_ID}:notification-action`
export const NOTIFICATION_ACTION_ACK = `${APP_ID}:notification-action-ack`
export const NOTIFICATION_ACTION_CACHE = `${APP_ID}-notification-actions-v2`

export type NotificationApprovalAction = 'allow' | 'allow-session' | 'deny'

export type NotificationApprovalOption = {
  action: NotificationApprovalAction
  label: string
  description?: string
}

export type NotificationWorkerAction = {
  type: typeof NOTIFICATION_ACTION
  action: 'read' | 'show' | NotificationApprovalAction
  notificationId: string
  sessionId?: string
  requestId?: string
}

/** Prioritizes approval actions when the desktop platform limits button count. */
export function desktopApprovalActions(
  options: NotificationApprovalOption[],
  maxActions: number,
) {
  return options.slice(0, maxActions).map(({ action, label }) => ({
    action,
    title: label,
  }))
}
