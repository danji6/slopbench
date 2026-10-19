export type NotificationApprovalAction = 'allow' | 'allow-session' | 'deny'

export type NotificationApprovalOption = {
  action: NotificationApprovalAction
  label: string
  description?: string
}

export type NotificationWorkerAction = {
  type: 'slopbench:notification-action'
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
