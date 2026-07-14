import { Button } from '@/components/ui'
import { Terminal, type TerminalHandle } from '@/components/ui/terminal'
import { useCode } from '@/hooks'
import { useIsWorkspaceAdmin } from '@/hooks/chat'
import { useActiveSessionId } from '@/hooks/chat/session'
import { type JobTail, useJobTail } from '@/hooks/chat/terminals'
import { useToolOutput } from '@/hooks/chat/tool-output'
import { useDebouncedCallback, useDelayedFlag } from '@/hooks/debounce'
import type { ShellToolOutput } from '@/lib/chat'
import { parseOutputValue } from '@/lib/chat/tool-output'
import { toast } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { ToolUIPart } from 'ai'
import { useAction } from 'convex/react'
import { ArrowDownFromLineIcon, BanIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useTerminalFeed } from '../../../../hooks/terminal-feed'
import { LoadFullOutput } from './load-full-output'
import { ToolShell } from './tool-shell'

// Terminals that have already revealed themselves once, persisted across
// remounts for stable virtualization
const revealedTerminals = new Set<string>()

export function ShellBlock({
  part,
  messageId,
  forceError,
  dense,
}: {
  part: ToolUIPart
  messageId: string
  forceError?: boolean
  dense?: boolean
}) {
  const input = part.input as
    | { command?: string; jobId?: string; run_in_background?: boolean }
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
  const optimisticBackground = detached && output?.status === 'running'

  const isBackground = output?.status === 'background' || optimisticBackground

  // Conditions under which a backgrounded job may be tailed for live status
  const canTail =
    Boolean(output?.jobId) && isBackground && isAdmin && sessionId !== null

  // Last live status reported by the expanded terminal
  const [liveTail, setLiveTail] = useState<JobTail | undefined>(undefined)
  const reportTail = useCallback(
    (tail: JobTail) => setLiveTail(canTail ? tail : undefined),
    [canTail],
  )

  // Effective status
  const liveStatus = (canTail ? liveTail?.status : undefined) ?? output?.status
  const isLive = liveStatus === 'running' || liveStatus === 'background'
  const terminated =
    killed ||
    liveStatus === 'killed' ||
    liveStatus === 'timeout' ||
    liveStatus === 'lost'

  const interactive = useDelayedFlag(
    isLive && !isBackground && isAdmin && sessionId !== null,
  )
  // Reveal an interactive terminal only the first time it goes live
  const revealTerminal = useRevealOnce(part.toolCallId, interactive)

  const displayTerm =
    fullOutput?.term ?? (canTail ? liveTail?.term : undefined) ?? output?.term
  const hasTerminalText =
    typeof displayTerm === 'string' && displayTerm.trim() !== ''
  const hasTerminal =
    output !== undefined &&
    typeof output.term === 'string' &&
    (isLive || hasTerminalText)

  const suppressJobText = Boolean(output?.jobId) && output?.status !== 'lost'
  const fallbackText =
    hasTerminal || suppressJobText
      ? undefined
      : part.state === 'output-available' && typeof part.output === 'string'
        ? part.output
        : output?.text

  const showLiveActions = Boolean(output?.jobId) && isLive && !killed
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
      autoExpand={interactive}
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
      className={dense ? 'px-2' : 'px-2 pt-1.5 pb-2'}
    >
      {hasContent && (
        <>
          {hasTerminal && (
            <ShellTerminal
              jobId={output.jobId}
              output={output}
              fullOutput={fullOutput}
              tailEnabled={canTail}
              onTail={reportTail}
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
              {showLiveActions && output && (
                <>
                  <KillButton
                    jobId={output.jobId}
                    onKilled={() => setKilled(true)}
                    onError={() => setKilled(false)}
                  />
                  {output.status === 'running' && !detached && (
                    <SendToBackgroundButton
                      jobId={output.jobId}
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
  input: { command?: string; jobId?: string } | undefined
  output: ShellToolOutput | undefined
  background?: boolean
  terminated?: boolean
}) {
  const status = terminated
    ? 'terminated'
    : output?.status === 'background' || background
      ? 'background'
      : null

  return (
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
  )
}

function HighlightedCommand({ command }: { command: string }) {
  const code = useCode(command, 'shell')
  if (!code) return <span className="text-foreground">{command}</span>
  return (
    <span
      className="text-foreground [&_.line]:inline [&_code]:inline [&>pre]:m-0! [&>pre]:inline [&>pre]:bg-transparent! [&>pre]:p-0! [&>pre]:whitespace-pre-wrap [&>pre]:outline-none"
      dangerouslySetInnerHTML={{ __html: code }}
    />
  )
}

function ShellTerminal({
  jobId,
  output,
  fullOutput,
  tailEnabled,
  onTail,
}: {
  jobId: string
  output: ShellToolOutput
  fullOutput: ShellToolOutput | undefined
  tailEnabled: boolean
  onTail: (tail: JobTail) => void
}) {
  const sessionId = useActiveSessionId() as Id<'sessions'> | null
  const isAdmin = useIsWorkspaceAdmin()
  const handleRef = useRef<TerminalHandle>(null)
  const writeTerminal = useAction(api.actions.terminals.write)
  const resizeTerminal = useAction(api.actions.terminals.resize)

  const tail = useJobTail(sessionId, jobId, tailEnabled)
  useEffect(() => {
    if (tailEnabled) onTail(tail)
  }, [tail, tailEnabled, onTail])

  const showingTail = tailEnabled && tail.status !== undefined
  const liveStatus = showingTail ? tail.status : output.status
  const live = liveStatus === 'running' || liveStatus === 'background'
  const interactive = live && isAdmin && sessionId !== null

  const term = fullOutput?.term ?? (showingTail ? tail.term : output.term)
  const termOffset =
    fullOutput?.termOffset ??
    (showingTail ? tail.termOffset : output.termOffset)
  const resetFeed = useTerminalFeed(handleRef, term, termOffset)

  const showingFull = fullOutput !== undefined
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

/** Latches `true` the first time `trigger` fires for `id`, surviving remounts. */
function useRevealOnce(id: string, trigger: boolean): boolean {
  useEffect(() => {
    if (trigger) revealedTerminals.add(id)
  }, [trigger, id])
  return trigger || revealedTerminals.has(id)
}
