import { List, RippleButton } from '@/components/ui'
import { Popover } from '@/components/ui/popover'
import { useIsWorkspaceAdmin } from '@/hooks/chat'
import { useActiveSessionId } from '@/hooks/chat/session'
import { useSessionJobs } from '@/hooks/chat/terminals'
import type { ShellJobSummary } from '@/lib/chat'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import { BanIcon, SquareIcon, SquareTerminalIcon } from 'lucide-react'
import { useState } from 'react'

import {
  highlightTargetForRow,
  useMessageHighlight,
} from '../messages/message-highlight-context'
import { useMessageSeek } from '../messages/message-seek-context'
import { openToolBlock } from '../messages/tools/tool-shell'

export function TerminalsWidget({ className }: { className?: string }) {
  const sessionId = useActiveSessionId() as Id<'sessions'> | null
  const isAdmin = useIsWorkspaceAdmin()
  const { jobs, dropJob } = useSessionJobs(
    sessionId,
    isAdmin && sessionId !== null,
  )
  const killAll = useAction(api.actions.terminals.killAll)

  const seek = useMessageSeek()
  const highlight = useMessageHighlight()
  const [open, setOpen] = useState(false)

  const running = jobs.filter((job) => job.status === 'running')

  /** Scrolls to the job's terminal block in the conversation and opens it. */
  function showTerminal(job: ShellJobSummary) {
    const messageId = job.messageId
    if (!messageId) return
    setOpen(false)
    openToolBlock(messageId, job.toolCallId)
    seek?.({
      messageId,
      creationTime: job.messageCreatedAt,
      toolCallId: job.toolCallId,
      onLocated: (row) =>
        highlight?.setTarget(highlightTargetForRow(messageId, row)),
    })
  }

  if (!isAdmin || !sessionId || running.length === 0) return null

  function handleKillAll() {
    if (!sessionId) return
    running.forEach((job) => dropJob(job.jobId))
    killAll({ sessionId }).catch(() => toast.error('Failed to stop terminals'))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          'text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-full cursor-pointer items-center gap-1 rounded-full px-2 outline-0 transition-colors focus-visible:ring-1',
          className,
        )}
        aria-label={`${running.length} running terminal${running.length === 1 ? '' : 's'}`}
      >
        <SquareTerminalIcon className="size-4" />
        <span className="text-xs tabular-nums">{running.length}</span>
      </Popover.Trigger>
      <Popover.Content align="end" side="top" className="w-72">
        <Popover.Header>
          <Popover.Title>Terminals</Popover.Title>
          <Popover.Description>
            {running.length} running job{running.length === 1 ? '' : 's'}
          </Popover.Description>
        </Popover.Header>

        <List
          items={running}
          keys={(job) => job.jobId}
          render={(job) => (
            <JobRow
              job={job}
              sessionId={sessionId}
              onKilled={dropJob}
              onOpen={showTerminal}
            />
          )}
          className="flex flex-col gap-2"
        />

        {running.length > 1 && (
          <RippleButton
            variant="input"
            size="sm"
            onClick={handleKillAll}
            className="text-muted-foreground self-start text-xs"
          >
            <SquareIcon /> Stop all
          </RippleButton>
        )}
      </Popover.Content>
    </Popover>
  )
}

function JobRow({
  job,
  sessionId,
  onKilled,
  onOpen,
}: {
  job: ShellJobSummary
  sessionId: Id<'sessions'>
  onKilled: (jobId: string) => void
  onOpen: (job: ShellJobSummary) => void
}) {
  const kill = useAction(api.actions.terminals.kill)

  function handleKill() {
    onKilled(job.jobId)
    kill({ sessionId, jobId: job.jobId }).catch(() =>
      toast.error('Failed to stop terminal'),
    )
  }

  return (
    <div className="flex items-center gap-1">
      <RippleButton
        variant="stealth"
        disabled={!job.messageId}
        onClick={() => onOpen(job)}
        aria-label={`Show terminal for ${job.command}`}
        className="h-auto min-w-0 flex-1 flex-col items-stretch gap-0.5 rounded-md px-2 py-1.5 text-left"
      >
        <span className="truncate font-mono text-xs">{job.command}</span>
        <span className="text-muted-foreground truncate text-[10px]">
          {job.jobId}
          {job.background && ' • background'} • {formatElapsed(job.startedAt)}
        </span>
      </RippleButton>
      <RippleButton
        variant="stealth"
        size="icon"
        onClick={handleKill}
        className="text-muted-foreground shrink-0"
        aria-label="Stop terminal"
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
