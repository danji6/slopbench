import { SessionAvatar } from '@/components/chat/sessions/session-avatar'
import type { AvatarProps } from '@/components/ui'
import type { NotificationItem } from '@/lib/chat/notification-ui'
import { BotIcon, UserIcon } from 'lucide-react'

type NotificationAvatarProps = Pick<AvatarProps, 'className' | 'size'> & {
  notification: NotificationItem
}

/** Stable actor avatar with a notification kind fallback. */
export function NotificationAvatar({
  notification,
  size = 'sm',
  className,
}: NotificationAvatarProps) {
  const fallbackIcon =
    notification.kind === 'user_message' ? <UserIcon /> : <BotIcon />

  return (
    <SessionAvatar
      avatarId={notification.actorAvatarId}
      alt={notification.actorName}
      fallbackIcon={fallbackIcon}
      size={size}
      className={className}
      noHover
    />
  )
}
