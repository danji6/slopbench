import { Button } from '@/components/ui'
import {
  Terminal,
  type TerminalHandle,
  prefetchTerminal,
} from '@/components/ui/terminal'
import { TerminalText } from '@/components/ui/terminal-text'
import { useIsWorkspaceAdmin } from '@/hooks/chat'
import { useActiveSessionId } from '@/hooks/chat/session'
import { useJobTail, useLiveShellJob } from '@/hooks/chat/terminals'
import { useToolOutput } from '@/hooks/chat/tool-output'
import { useDebouncedCallback } from '@/hooks/debounce'
import { useLatch } from '@/hooks/latch'
import { useTerminalFeed } from '@/hooks/terminal-feed'
import type { ShellToolOutput } from '@/lib/chat'
import { parseOutputValue } from '@/lib/chat/tool-output'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { needsEmulator } from '@sb/core/shell/ansi'
import type { ToolUIPart } from 'ai'
import { useAction } from 'convex/react'
import { ArrowDownFromLineIcon, BanIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { HighlightedCommand } from './highlighted-command'
import { LoadFullOutput } from './load-full-output'
import { useShellGroup } from './shell-group-block'
import { ToolShell } from './tool-shell'

export function ShellBlock({
  part,
  messageId,
  forceError,
  dense,
  alwaysExpand,
}: {
  part: ToolUIPart
  messageId: string
  forceError?: boolean
  dense?: boolean
  /** Opens the block as soon as it has a body. */
  alwaysExpand?: boolean
}) {
  const input = part.input as
    | {
        command?: string
        description?: string
        jobId?: string
        run_in_background?: boolean
      }
    | undefined

  const {
    output: rawOutput,
    truncated,
    loadFull,
    loadingFull,
  } = useToolOutput(part, messageId)

  const output =
    part.state === 'output-available'
      ? parseOutputValue<ShellToolOutput>(part.output)
      : undefined

  const fullOutput =
    rawOutput === part.output
      ? undefined
      : parseOutputValue<ShellToolOutput>(rawOutput)

  const sessionId = useActiveSessionId() as Id<'sessions'> | null
  const isAdmin = useIsWorkspaceAdmin()

  // Optimistic flags
  const [detached, setDetached] = useState(false)
  const [killed, setKilled] = useState(false)

  // What the sidecar knows about this shell, independently of the turn itself
  const mayBeLive =
    part.state !== 'output-available' ||
    output?.status === 'running' ||
    output?.status === 'background'
  const liveJob = useLiveShellJob(
    sessionId,
    mayBeLive && isAdmin,
    part.toolCallId,
    output?.jobId,
  )
  const jobId = output?.jobId ?? liveJob?.jobId

  const canTail =
    Boolean(jobId) &&
    isAdmin &&
    sessionId !== null &&
    !killed &&
    Boolean(liveJob)
  const tail = useJobTail(sessionId, jobId ?? '', canTail)
  const tailing = canTail && tail.status !== undefined

  const optimisticBackground = detached && liveJob?.status === 'running'
  const isBackground =
    liveJob?.background ??
    (output?.status === 'background' || optimisticBackground)

  // Effective status, which may be different than the persisted one
  const attestedStatus = (tailing ? tail.status : undefined) ?? liveJob?.status
  const liveStatus = attestedStatus ?? output?.status
  const isLive = liveStatus === 'running' || liveStatus === 'background'
  const terminated =
    killed ||
    liveStatus === 'killed' ||
    liveStatus === 'timeout' ||
    liveStatus === 'lost'

  // A persisted status may be stale, while this one comes directly from the sidecar
  const confirmedLive =
    attestedStatus === 'running' || attestedStatus === 'background'

  const shellGroup = useShellGroup()
  useEffect(() => {
    shellGroup?.reportRunning(part.toolCallId, confirmedLive)
  }, [shellGroup, part.toolCallId, confirmedLive])

  const waiting =
    (tailing ? tail.waiting : undefined) ?? liveJob?.waiting ?? output?.waiting

  // Auto-expand only when the sidecar reports the job is waiting on terminal input
  const interactive =
    Boolean(waiting) && isLive && !isBackground && isAdmin && sessionId !== null
  const displayTerm =
    fullOutput?.term ?? (tailing ? tail.term : undefined) ?? output?.term
  const hasTerminalText =
    typeof displayTerm === 'string' && displayTerm.trim() !== ''
  // A live job always gets a terminal, even before any output was persisted
  const hasTerminal = Boolean(jobId) && (isLive || hasTerminalText)

  // Reveal an interactive terminal only the first time it goes live
  const revealTerminal = useLatch(
    `reveal:${part.toolCallId}`,
    interactive || (Boolean(alwaysExpand) && hasTerminal),
  )

  // Emulate only if the shell is interactive or redraws with cursor addressing
  const cursorAddressed = useMemo(
    () => needsEmulator(displayTerm ?? ''),
    [displayTerm],
  )
  const emulator = useLatch(
    `emulator:${part.toolCallId}`,
    Boolean(waiting) || cursorAddressed,
  )

  // A live job may block on input at any moment, so warm the chunk behind it
  useEffect(() => {
    if (isLive && isAdmin && !isBackground) prefetchTerminal()
  }, [isLive, isAdmin, isBackground])

  // Live output uses a fixed height for stable virtualization
  const isFixedHeight = useLatch(`live:${part.toolCallId}`, isLive)

  const suppressJobText = Boolean(output?.jobId) && output?.status !== 'lost'
  const fallbackText =
    hasTerminal || suppressJobText
      ? undefined
      : part.state === 'output-available' && typeof part.output === 'string'
        ? part.output
        : output?.text

  const showLiveActions = Boolean(jobId) && isLive && !killed
  const hasActions = showLiveActions || (truncated && !fullOutput)

  const hasContent =
    hasTerminal ||
    Boolean(fallbackText) ||
    Boolean(!hasTerminal && fullOutput?.text) ||
    hasActions

  return (
    <ToolShell
      data-slot="shell-block"
      part={part}
      messageId={messageId}
      forceError={forceError}
      autoExpand={interactive || Boolean(alwaysExpand)}
      reveal={revealTerminal}
      revealOnOpen={false}
      fullWidth={hasTerminal}
      surface={hasTerminal}
      noErrorText={hasTerminal || Boolean(fallbackText)}
      dense={dense}
      label={
        <ShellLabel
          input={input}
          output={output}
          background={optimisticBackground}
          terminated={terminated}
        />
      }
      className={cn(
        'px-2',
        dense ? 'data-[open=true]:my-1 data-[open=true]:py-2' : 'pt-1.5 pb-2',
      )}
    >
      {hasContent && (
        <>
          {hasTerminal && jobId && (
            <ShellTerminal
              jobId={jobId}
              term={displayTerm ?? ''}
              termOffset={
                fullOutput?.termOffset ??
                (tailing ? tail.termOffset : undefined) ??
                output?.termOffset ??
                0
              }
              live={isLive}
              showingFull={fullOutput !== undefined}
              emulator={emulator}
              fixedHeight={isFixedHeight}
            />
          )}
          {fallbackText && (
            <pre className="max-h-72 overflow-auto font-mono text-xs whitespace-pre-wrap">
              {fallbackText}
            </pre>
          )}
          {!hasTerminal && fullOutput?.text && (
            <pre className="max-h-72 overflow-auto font-mono text-xs whitespace-pre-wrap">
              {fullOutput.text}
            </pre>
          )}
          {hasActions && (
            <div className="flex w-full items-center gap-2">
              {showLiveActions && jobId && (
                <>
                  <KillButton
                    jobId={jobId}
                    onKilled={() => setKilled(true)}
                    onError={() => setKilled(false)}
                  />
                  {liveStatus === 'running' && !detached && (
                    <SendToBackgroundButton
                      jobId={jobId}
                      onDetached={() => setDetached(true)}
                      onError={() => setDetached(false)}
                    />
                  )}
                </>
              )}
              {truncated && !fullOutput && (
                <LoadFullOutput onLoad={loadFull} loading={loadingFull} />
              )}
            </div>
          )}
        </>
      )}
    </ToolShell>
  )
}

function ShellLabel({
  input,
  output,
  background,
  terminated,
}: {
  input: { command?: string; description?: string; jobId?: string } | undefined
  output: ShellToolOutput | undefined
  background?: boolean
  terminated?: boolean
}) {
  const status = terminated
    ? 'terminated'
    : output?.status === 'background' || background
      ? 'background'
      : null
  const description = input?.description?.trim()

  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono">
        <span className="text-foreground/70">$</span>{' '}
        {input?.command ? (
          <HighlightedCommand command={input.command} />
        ) : (
          <span className="text-foreground/70">
            output of job {input?.jobId ?? '…'}
          </span>
        )}
        {status && (
          <span className="text-muted-foreground ml-2 text-[10px] uppercase">
            {status}
          </span>
        )}
      </span>
      {description && (
        <span className="text-muted-foreground text-[11px]">{description}</span>
      )}
    </span>
  )
}

function ShellTerminal({
  jobId,
  term,
  termOffset,
  live,
  showingFull,
  emulator,
  fixedHeight,
}: {
  jobId: string
  term: string
  termOffset: number
  live: boolean
  showingFull: boolean
  emulator: boolean
  fixedHeight: boolean
}) {
  const sessionId = useActiveSessionId() as Id<'sessions'> | null
  const isAdmin = useIsWorkspaceAdmin()
  const handleRef = useRef<TerminalHandle>(null)
  const writeTerminal = useAction(api.actions.terminals.write)
  const resizeTerminal = useAction(api.actions.terminals.resize)

  const interactive = live && isAdmin && sessionId !== null
  const resetFeed = useTerminalFeed(handleRef, term, termOffset)

  useEffect(() => {
    if (!showingFull) return
    handleRef.current?.clear()
    resetFeed()
  }, [showingFull, resetFeed])

  const resize = useDebouncedCallback((cols: number, rows: number) => {
    if (live && isAdmin && sessionId) {
      void resizeTerminal({ sessionId, jobId, cols, rows }).catch(() => {})
    }
  }, 500)

  return (
    <div
      data-slot="terminal-wrapper"
      className="bg-m3-surface-container-lowest rounded-lg border p-2"
    >
      {emulator ? (
        <Terminal
          ref={handleRef}
          readOnly={!interactive}
          onReady={resetFeed}
          onData={(data) => {
            if (!interactive) return
            void writeTerminal({ sessionId, jobId, data }).catch(() => {})
          }}
          onResize={resize.run}
        />
      ) : (
        <TerminalText
          ref={handleRef}
          onReady={resetFeed}
          className={fixedHeight ? 'h-72' : 'max-h-72'}
        />
      )}
    </div>
  )
}

function KillButton({
  jobId,
  onKilled,
  onError,
}: {
  jobId: string
  onKilled: () => void
  onError: () => void
}) {
  const sessionId = useActiveSessionId() as Id<'sessions'> | null
  const isAdmin = useIsWorkspaceAdmin()
  const killTerminal = useAction(api.actions.terminals.kill)

  if (!isAdmin || !sessionId) return null

  function handleClick() {
    if (!sessionId) return
    onKilled()
    killTerminal({ sessionId, jobId }).catch(() => {
      onError()
      toast.error('Failed to kill terminal')
    })
  }

  return (
    <Button
      variant="input"
      size="sm"
      onClick={handleClick}
      className="text-muted-foreground text-xs"
    >
      <BanIcon /> Kill Terminal
    </Button>
  )
}

function SendToBackgroundButton({
  jobId,
  onDetached,
  onError,
}: {
  jobId: string
  onDetached: () => void
  onError: () => void
}) {
  const sessionId = useActiveSessionId() as Id<'sessions'> | null
  const isAdmin = useIsWorkspaceAdmin()
  const sendToBackground = useAction(api.actions.terminals.background)

  if (!isAdmin || !sessionId) return null

  function handleClick() {
    if (!sessionId) return
    onDetached()
    sendToBackground({ sessionId, jobId }).catch(() => {
      onError()
      toast.error('Failed to send job to the background')
    })
  }

  return (
    <Button
      variant="input"
      size="sm"
      onClick={handleClick}
      className="text-muted-foreground text-xs"
    >
      <ArrowDownFromLineIcon /> Send to background
    </Button>
  )
}
