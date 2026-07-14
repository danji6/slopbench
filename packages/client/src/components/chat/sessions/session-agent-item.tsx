import { RippleButton } from '@/components/ui'
import type { LinkedAgent } from '@/hooks/chat'
import { XIcon } from 'lucide-react'

import { ParticipantRow } from './participant-row'

interface SessionAgentItemProps {
  agent: LinkedAgent
  isActive: boolean
  canUnlink: boolean
  onActivate: () => void
  onUnlink: () => void
}

export function SessionAgentItem({
  agent,
  isActive,
  canUnlink,
  onActivate,
  onUnlink,
}: SessionAgentItemProps) {
  return (
    <ParticipantRow
      name={agent.name}
      avatarId={agent.avatarId}
      active={isActive}
      onClick={onActivate}
      badge={
        isActive && (
          <span className="text-secondary shrink-0 text-xs font-semibold">
            Active
          </span>
        )
      }
      action={
        canUnlink && (
          <RippleButton
            size="icon"
            variant="stealth"
            aria-label={`Unlink ${agent.name}`}
            className="size-7"
            onClick={(e) => {
              e.stopPropagation()
              onUnlink()
            }}
          >
            <XIcon className="size-4" />
          </RippleButton>
        )
      }
    />
  )
}
