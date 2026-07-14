import { RippleButton } from '@/components/ui'
import type { SessionMember } from '@/lib/chat'
import { FALLBACK_DISPLAY_NAME } from '@sb/core/const'
import { capitalize } from '@sb/core/utils/strings'
import { UserIcon, XIcon } from 'lucide-react'

import { ParticipantRow } from './participant-row'

interface SessionMemberItemProps {
  member: SessionMember
  canRemove: boolean
  onRemove: () => void
}

export function SessionMemberItem({
  member,
  canRemove,
  onRemove,
}: SessionMemberItemProps) {
  const { membership, settings } = member
  return (
    <ParticipantRow
      name={settings?.displayName ?? FALLBACK_DISPLAY_NAME}
      avatarId={settings?.avatarId}
      fallbackIcon={<UserIcon className="size-full" />}
      badge={
        <span className="text-muted-foreground shrink-0 text-xs">
          {capitalize(membership.role)}
        </span>
      }
      action={
        canRemove && (
          <RippleButton
            size="icon"
            variant="stealth"
            aria-label="Remove member"
            className="size-7"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <XIcon className="size-4" />
          </RippleButton>
        )
      }
    />
  )
}
