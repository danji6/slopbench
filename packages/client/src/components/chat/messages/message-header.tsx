import { Avatar } from '@/components/ui'
import { useLightbox } from '@/components/ui/lightbox'
import { useAvatarUrls } from '@/hooks/chat'
import type { MessageRole, UIAvatar } from '@/lib/chat'
import { cn } from '@/lib/utils'
import type { Id } from '@sb/convex/_generated/dataModel'
import { BotIcon, CogIcon, UserIcon } from 'lucide-react'
import { useCallback } from 'react'

export type MessageSender = { name: string; avatarId?: Id<'avatars'> }

export type MessageHeaderProps = {
  sender: MessageSender
  role: MessageRole
  /** Content rendered inline after the name. */
  extra?: React.ReactNode
  /** Pulls the avatar into the row's left gutter if there's space. */
  gutter?: boolean
}

const GUTTER_AVATAR = [
  'size-[var(--avatar-size,40px)]',
  'ml-[calc(var(--message-gutter,0px)*-1)]',
  'mb-[calc(var(--message-gutter,0px)*var(--avatar-lift,0)*-1)]',
  'translate-y-[calc(var(--message-gutter,0px)*var(--avatar-drop,0))]',
].join(' ')

export function MessageHeader({
  sender,
  role,
  extra,
  gutter,
}: MessageHeaderProps) {
  const avatarUrls = useAvatarUrls(sender.avatarId)

  const name = (
    <span className="text-foreground/70 text-md shrink-0 font-semibold tracking-wide">
      {sender.name}
    </span>
  )

  return (
    <div
      data-slot="message-header"
      className="flex items-center justify-start gap-4 px-1"
    >
      <AvatarWithLightbox
        thumbnail={avatarUrls.thumbnail ?? avatarUrls.original}
        original={avatarUrls.original}
        alt={sender.name}
        size="md"
        fallbackIcon={<RoleIcon role={role} />}
        className={gutter ? GUTTER_AVATAR : undefined}
      />
      {extra ? (
        <div className="flex min-w-0 items-baseline gap-x-2">
          {name}
          {extra}
        </div>
      ) : (
        name
      )}
    </div>
  )
}

function RoleIcon({ role }: { role: MessageRole }) {
  const Icon =
    role === 'user' ? UserIcon : role === 'system' ? CogIcon : BotIcon
  return <Icon />
}

function AvatarWithLightbox({
  thumbnail,
  original,
  alt,
  size = 'md',
  fallbackIcon,
  className,
}: UIAvatar & {
  alt?: string
  size?: 'sm' | 'md' | 'lg'
  fallbackIcon?: React.ReactNode
  className?: string
}) {
  const lightbox = useLightbox()
  const handleClick = useCallback(() => {
    if (original && lightbox) lightbox.open(original, alt)
  }, [original, alt, lightbox])

  return (
    <Avatar
      src={thumbnail}
      alt={alt}
      size={size}
      fallbackIcon={fallbackIcon}
      onClick={original ? handleClick : undefined}
      className={cn(original && 'cursor-pointer', className)}
    />
  )
}
