import { Popover, QuickTooltip, RippleButton, Tabs } from '@/components/ui'
import { notificationBody } from '@/lib/chat/notification-ui'
import { cn, formatRelativeTime } from '@/lib/utils'
import type { Doc } from '@sb/convex/_generated/dataModel'
import { BellIcon, BroomIcon, MailOpenIcon } from 'lucide-react'
import { useState } from 'react'

import { NotificationAvatar } from './notification-avatar'
import { useNotifications } from './notification-provider'

/** The sidebar trigger and durable Unread/Read inbox popover. */
export function NotificationInboxButton() {
  const notifications = useNotifications()
  const [tab, setTab] = useState('unread')
  const unreadCount = notifications.unread.length

  return (
    <Popover>
      <QuickTooltip text="Notifications" side="left">
        <Popover.Trigger
          render={
            <RippleButton
              variant="stealth"
              size="icon"
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
              className="text-muted-foreground"
            />
          }
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span className="bg-m3-error text-m3-on-error absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-bold">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Popover.Trigger>
      </QuickTooltip>
      <Popover.Content
        side="left"
        align="end"
        className="h-[min(28rem,calc(100dvh-2rem))] w-96 gap-0 overflow-hidden p-0"
      >
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="min-h-0 flex-1 gap-0"
        >
          <Tabs.List className="h-11 shrink-0 gap-0 overflow-hidden rounded-t-lg px-0 **:data-[slot=tabs-trigger]:rounded-none **:data-[slot=tabs-trigger]:border-none">
            <Tabs.Trigger value="unread">Unread</Tabs.Trigger>
            <Tabs.Trigger value="read">Read</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Panels>
            <Tabs.Content value="unread" className="h-full">
              <NotificationPanel
                action={
                  <RippleButton
                    variant="input"
                    size="sm"
                    className={cn(notifications.unread.length > 0 && 'hidden')}
                    onClick={notifications.markAllRead}
                  >
                    <MailOpenIcon /> Mark all as read
                  </RippleButton>
                }
                footer={<DesktopPermission />}
              >
                <NotificationList
                  items={notifications.unread}
                  empty="No unread notifications"
                  unread
                />
              </NotificationPanel>
            </Tabs.Content>
            <Tabs.Content value="read" className="h-full">
              <NotificationPanel
                action={
                  <RippleButton
                    variant="input"
                    size="sm"
                    className={cn(notifications.unread.length > 0 && 'hidden')} // prettier-ignore
                    onClick={notifications.clearRead}
                  >
                    <BroomIcon /> Clear all read
                  </RippleButton>
                }
              >
                <NotificationList
                  items={notifications.read}
                  empty="No read notifications"
                />
              </NotificationPanel>
            </Tabs.Content>
          </Tabs.Panels>
        </Tabs>
      </Popover.Content>
    </Popover>
  )
}

/** Keeps the action and optional footer fixed while only the list scrolls. */
function NotificationPanel({
  action,
  children,
  footer,
}: {
  action: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex h-11 shrink-0 items-center justify-start px-3 pt-3">
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{children}</div>
      {footer}
    </div>
  )
}

function DesktopPermission() {
  const { desktopPermission, enableDesktop } = useNotifications()
  if (desktopPermission === 'granted') return null

  if (desktopPermission === 'default') {
    return (
      <div className="mx-auto shrink-0 p-2">
        <RippleButton size="sm" onClick={() => void enableDesktop()}>
          Enable desktop notifications
        </RippleButton>
      </div>
    )
  }

  return (
    <div className="border-input text-muted-foreground shrink-0 border-t p-3 text-xs">
      {desktopPermission === 'denied'
        ? 'Desktop notifications are blocked in browser settings.'
        : 'Desktop notifications are not supported in this browser context.'}
    </div>
  )
}

function NotificationList({
  items,
  empty,
  unread = false,
}: {
  items: Doc<'notifications'>[]
  empty: string
  unread?: boolean
}) {
  if (items.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full flex-1 items-center justify-center text-sm">
        {empty}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {items.map((notification) => (
        <NotificationRow
          key={notification._id}
          notification={notification}
          unread={unread}
        />
      ))}
    </div>
  )
}

function NotificationRow({
  notification,
  unread,
}: {
  notification: Doc<'notifications'>
  unread: boolean
}) {
  const { openSession, markRead } = useNotifications()

  return (
    <div
      className={cn(
        'hover:bg-m3-surface-container-high group flex items-center rounded-lg',
        !unread && 'text-muted-foreground',
      )}
    >
      <Popover.Close
        render={
          <RippleButton variant={null} size={null} rippleVariant="stealth" />
        }
        className="min-w-0 flex-1 shrink items-start justify-start gap-2 rounded-lg p-2 text-left font-normal whitespace-normal"
        onClick={() => openSession(notification)}
      >
        <NotificationAvatar
          notification={notification}
          className={cn(!unread && 'opacity-70')}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1">
            <span className="truncate font-medium">
              {notification.actorName}
            </span>
            <span className="text-muted-foreground ml-auto shrink-0 text-xs">
              {formatRelativeTime(
                notification.readAt ?? notification._creationTime,
              )}
            </span>
          </span>
          <span className="line-clamp-2">{notificationBody(notification)}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {notification.sessionTitle}
          </span>
        </span>
      </Popover.Close>
      {unread && (
        <RippleButton
          variant="stealth"
          size="icon-sm"
          className="mr-1 shrink-0"
          aria-label={`Mark notification from ${notification.actorName} as read`}
          title="Mark as read"
          onClick={(event) => {
            event.stopPropagation()
            markRead(notification)
          }}
        >
          <MailOpenIcon />
        </RippleButton>
      )}
    </div>
  )
}
