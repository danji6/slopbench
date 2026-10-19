import { RippleButton } from '@/components/ui'
import {
  type NotificationItem,
  isPendingNotification,
  notificationBody,
  notificationRequestLabel,
  notificationToastId,
} from '@/lib/chat/notification-ui'
import { toast } from '@/lib/notifications'
import type { NotificationApprovalAction } from '@sb/core/notification-actions'

import { NotificationApprovalActions } from './notification-approval-actions'
import { NotificationAvatar } from './notification-avatar'

type NotificationToastProps = {
  notification: NotificationItem
  onShow: () => void
  onRead: () => void
  controls?: { minimize: () => void; openInbox: () => void }
  onRespond: (action: NotificationApprovalAction) => Promise<void>
}

function NotificationToast({
  notification,
  onShow,
  onRead,
  onRespond,
  controls,
}: NotificationToastProps) {
  return (
    <div className="bg-popover text-popover-foreground ring-foreground/10 flex w-96 max-w-[calc(100vw-2rem)] gap-3 rounded-xl p-3 shadow-md ring-1">
      <NotificationAvatar notification={notification} className="size-9" />
      <div className="min-w-0 flex-1">
        <button className="w-full text-left" onClick={onShow}>
          <div className="text-m3-primary text-xs font-medium">
            {notificationRequestLabel(notification)}
          </div>
          <div className="truncate font-medium">{notification.actorName}</div>
          <div className="text-sm wrap-break-word">
            {notificationBody(notification)}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {notification.sessionTitle}
          </div>
        </button>
        {notification.approvalActions?.length > 0 ? (
          <NotificationApprovalActions
            options={notification.approvalActions}
            onRespond={onRespond}
          />
        ) : (
          <div className="mt-2 flex justify-end gap-1">
            {!isPendingNotification(notification) && (
              <RippleButton variant="stealth" size="sm" onClick={onRead}>
                Dismiss
              </RippleButton>
            )}
            <RippleButton variant="primary" size="sm" onClick={onShow}>
              {isPendingNotification(notification) ? 'Open chat' : 'Show'}
            </RippleButton>
          </div>
        )}
        {controls && (
          <div className="mt-2 flex justify-end gap-1">
            <RippleButton
              variant="stealth"
              size="sm"
              onClick={controls.minimize}
            >
              Minimize
            </RippleButton>
            <RippleButton
              variant="stealth"
              size="sm"
              onClick={controls.openInbox}
            >
              Open notifications
            </RippleButton>
          </div>
        )}
      </div>
    </div>
  )
}

/** Shows an in-app notification with responses scoped to one tool call. */
export function showNotificationToast(
  notification: NotificationItem,
  show: (notification: NotificationItem) => void,
  markRead: (notification: NotificationItem) => void,
  respond: (
    notification: NotificationItem,
    action: NotificationApprovalAction,
  ) => Promise<void>,
  controls?: NotificationToastProps['controls'],
) {
  const id = notificationToastId(notification._id)
  toast.custom(
    () => (
      <NotificationToast
        notification={notification}
        onShow={() => {
          show(notification)
          if (!isPendingNotification(notification)) toast.dismiss(id)
        }}
        controls={controls}
        onRead={() => {
          markRead(notification)
          toast.dismiss(id)
        }}
        onRespond={(action) => respond(notification, action)}
      />
    ),
    {
      id,
      duration: isPendingNotification(notification) ? Infinity : undefined,
      dismissible: !isPendingNotification(notification),
    },
  )
}
