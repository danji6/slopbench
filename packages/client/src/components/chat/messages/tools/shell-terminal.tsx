import { Terminal, type TerminalHandle } from '@/components/ui/terminal'
import { TerminalText } from '@/components/ui/terminal-text'
import { useActiveSessionId } from '@/hooks/chat/session'
import { useShellFocus } from '@/hooks/chat/shell-focus'
import { useIsWorkspaceAdmin } from '@/hooks/chat/tools'
import { useDebouncedCallback } from '@/hooks/debounce'
import { useTerminalFeed } from '@/hooks/terminal-feed'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import { type RefObject, useEffect, useRef, useState } from 'react'

type ShellTerminalProps = {
  jobId: string
  wrapperRef: RefObject<HTMLDivElement | null>
  term: string
  termOffset: number
  live: boolean
  inputAllowed: boolean
  focusWhenReady: boolean
  showingFull: boolean
  emulator: boolean
  fixedHeight: boolean
}

export function ShellTerminal({
  jobId,
  wrapperRef,
  term,
  termOffset,
  live,
  inputAllowed,
  focusWhenReady,
  showingFull,
  emulator,
  fixedHeight,
}: ShellTerminalProps) {
  const sessionId = useActiveSessionId() as Id<'sessions'> | null
  const isAdmin = useIsWorkspaceAdmin()
  const handleRef = useRef<TerminalHandle>(null)
  const [ready, setReady] = useState(false)
  const writeTerminal = useAction(api.actions.terminals.write)
  const resizeTerminal = useAction(api.actions.terminals.resize)
  const sentDimensionsRef = useRef<[number, number] | null>(null)

  const interactive = live && inputAllowed && isAdmin && sessionId !== null
  const resetFeed = useTerminalFeed(handleRef, term, termOffset)
  useShellFocus(jobId, ready && focusWhenReady, wrapperRef, handleRef)

  useEffect(() => {
    if (!showingFull) return
    resetFeed()
  }, [showingFull, resetFeed])

  const resize = useDebouncedCallback((cols: number, rows: number) => {
    if (!live || !isAdmin || !sessionId) return
    const sent = sentDimensionsRef.current
    // Skip dimensions already sent. A redundant pty resize raises SIGWINCH,
    // the program redraws, and the new output goes back into fit, causing a loop.
    if (sent && sent[0] === cols && sent[1] === rows) return
    sentDimensionsRef.current = [cols, rows]
    void resizeTerminal({ sessionId, jobId, cols, rows }).catch(() => {})
  }, 500)

  return (
    <div
      ref={wrapperRef}
      data-slot="terminal-wrapper"
      className="bg-m3-surface-container-lowest rounded-(--work-surface-inner-radius) border p-2 has-focus-visible:outline-1 has-[:focus-visible]:-outline-offset-1"
    >
      {emulator ? (
        <Terminal
          ref={handleRef}
          readOnly={!interactive}
          onReady={() => {
            resetFeed()
            setReady(true)
          }}
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
          className={cn(
            'focus-visible:outline-hidden',
            fixedHeight ? 'h-72' : 'max-h-72',
          )}
        />
      )}
    </div>
  )
}
