import { RippleButton } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { ReactNode } from 'react'

import { SessionAvatar } from './session-avatar'

interface ParticipantRowProps {
  name: string
  avatarId?: Id<'avatars'>
  fallbackIcon?: ReactNode
  active?: boolean
  badge?: ReactNode
  action?: ReactNode
  onClick?: () => void
}

export function ParticipantRow({
  name,
  avatarId,
  fallbackIcon,
  active,
  badge,
  action,
  onClick,
}: ParticipantRowProps) {
  return (
    <div className="relative w-full">
      <RippleButton
        variant="stealth"
        className={cn(
          'h-auto w-full justify-start gap-2.5 rounded-full py-1.5 pl-2',
          action ? 'pr-10' : 'pr-4',
          active && 'bg-m3-surface-container-high',
        )}
        onClick={onClick}
      >
        <SessionAvatar avatarId={avatarId} fallbackIcon={fallbackIcon} />
        <span className="min-w-0 flex-1 truncate text-start">{name}</span>
        {badge}
      </RippleButton>

      {action && (
        <div className="absolute top-1/2 right-1 -translate-y-1/2">
          {action}
        </div>
      )}
    </div>
  )
}
