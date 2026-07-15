import { RippleButton } from '@/components/ui'
import { isOngoingStream } from '@/lib/chat/stream'
import { api } from '@sb/convex/_generated/api'
import type { Doc } from '@sb/convex/_generated/dataModel'
import type { ChatStatus } from 'ai'
import { useQuery } from 'convex/react'
import { ArrowDownIcon, ArrowLeftIcon, SquareIcon } from 'lucide-react'
import { useLocation } from 'wouter'

import { TokenWidget } from '../widgets/token-widget'

/** Replaces the composer in sub-agent sessions. */
export function SubagentBanner({
  parent,
  status,
  onStop,
  onScrollToBottom,
}: {
  parent: NonNullable<Doc<'sessions'>['parent']>
  status: ChatStatus
  onStop: () => void
  onScrollToBottom: () => void
}) {
  const [, navigate] = useLocation()
  const agent = useQuery(api.agents.get, { agentId: parent.agentId })

  return (
    <div
      data-slot="subagent-banner"
      className="bg-m3-surface-container-low flex w-full items-center gap-3 rounded-xl border px-4 py-3 shadow-lg"
    >
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">Sub-agent session</span>
        <span className="text-muted-foreground truncate text-xs">
          Delegated by {agent?.name ?? 'another agent'}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {isOngoingStream(status) && (
          <RippleButton variant="input" size="sm" onClick={onStop}>
            <SquareIcon /> Stop
          </RippleButton>
        )}
        <RippleButton
          variant="surface"
          size="sm"
          onClick={() => navigate(`/?id=${parent.sessionId}`)}
        >
          <ArrowLeftIcon /> Back to parent
        </RippleButton>
        <div className="border-input/50 h-8 w-px border" />
        <TokenWidget className="h-8" />
        <div className="border-input/50 h-8 w-px border" />
        <RippleButton
          variant="input"
          size="icon-sm"
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
          onClick={onScrollToBottom}
        >
          <ArrowDownIcon />
        </RippleButton>
      </div>
    </div>
  )
}
