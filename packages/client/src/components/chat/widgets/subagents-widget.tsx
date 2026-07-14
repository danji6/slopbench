import { List, RippleButton } from '@/components/ui'
import { Popover } from '@/components/ui/popover'
import { useActiveSessionId } from '@/hooks/chat/session'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useMutation, useQuery } from 'convex/react'
import { BanIcon, BotIcon, SquareIcon } from 'lucide-react'
import { useLocation } from 'wouter'

type Subagent = NonNullable<
  ReturnType<typeof useQuery<typeof api.subagents.list>>
>[number]

export function SubagentsWidget({ className }: { className?: string }) {
  const sessionId = useActiveSessionId() as Id<'sessions'> | null
  const running = useQuery(
    api.subagents.list,
    sessionId ? { sessionId } : 'skip',
  )
  const stopAll = useMutation(api.subagents.stopAll)

  if (!sessionId || !running || running.length === 0) return null

  function handleStopAll() {
    if (!sessionId) return
    stopAll({ sessionId }).catch(() => toast.error('Failed to stop sub-agents'))
  }

  return (
    <Popover>
      <Popover.Trigger
        className={cn(
          'text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-full cursor-pointer items-center gap-1 rounded-full px-2 outline-0 transition-colors focus-visible:ring-1',
          className,
        )}
        aria-label={`${running.length} running sub-agent${running.length === 1 ? '' : 's'}`}
      >
        <BotIcon className="size-4" />
        <span className="text-xs tabular-nums">{running.length}</span>
      </Popover.Trigger>
      <Popover.Content align="end" className="w-72">
        <Popover.Header>
          <Popover.Title>Sub-agents</Popover.Title>
          <Popover.Description>
            {running.length} running in the background
          </Popover.Description>
        </Popover.Header>

        <List
          items={running}
          keys={(agent) => agent.sessionId}
          render={(agent) => (
            <SubagentRow agent={agent} sessionId={sessionId} />
          )}
          className="flex flex-col gap-2"
        />

        {running.length > 1 && (
          <RippleButton
            variant="input"
            size="sm"
            onClick={handleStopAll}
            className="text-muted-foreground self-start text-xs"
          >
            <SquareIcon /> Stop all
          </RippleButton>
        )}
      </Popover.Content>
    </Popover>
  )
}

function SubagentRow({
  agent,
  sessionId,
}: {
  agent: Subagent
  sessionId: Id<'sessions'>
}) {
  const [, navigate] = useLocation()
  const stop = useMutation(api.subagents.stop)
  const stopping = agent.status === 'stopping'

  function handleStop() {
    stop({ sessionId, childSessionId: agent.sessionId }).catch(() =>
      toast.error('Failed to stop sub-agent'),
    )
  }

  return (
    <div className="flex items-center gap-1">
      <RippleButton
        variant="stealth"
        onClick={() => navigate(`/?id=${agent.sessionId}`)}
        className="h-auto min-w-0 flex-1 flex-col items-stretch gap-0.5 rounded-md px-2 py-1.5 text-left"
        title="Open the sub-agent session"
      >
        <span className="truncate text-xs font-medium">
          {agent.agentName ?? 'Sub-agent'}
        </span>
        <span className="text-muted-foreground truncate text-[10px]">
          {agent.title ?? agent.sessionId} · {formatElapsed(agent.startedAt)}
        </span>
      </RippleButton>
      <RippleButton
        variant="stealth"
        size="icon"
        onClick={handleStop}
        disabled={stopping}
        className="text-muted-foreground shrink-0"
        aria-label="Stop sub-agent"
      >
        <BanIcon />
      </RippleButton>
    </div>
  )
}

function formatElapsed(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
}
