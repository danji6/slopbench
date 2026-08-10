import { type TextTerminal, createTextTerminal } from '@/lib/terminal-text'
import { cn } from '@/lib/utils'
import { useEffect, useImperativeHandle, useRef } from 'react'

import type { TerminalProps } from './terminal-view'

/**
 * Read-only terminal rendered as plain styled text. Works as a cheap drop-in
 * replacement for Terminal.
 */
export function TerminalText({ ref, onReady, className }: TerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const handleRef = useRef<TextTerminal | null>(null)
  handleRef.current ??= createTextTerminal({
    scroll: () => scrollRef.current,
    lines: () => preRef.current,
  })

  useImperativeHandle(ref, () => handleRef.current as TextTerminal, [])

  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  })

  useEffect(() => {
    handleRef.current?.flush()
    onReadyRef.current?.()
  }, [])

  return (
    <div
      ref={scrollRef}
      data-slot="terminal-text"
      className={cn('overflow-auto overscroll-contain', className)}
    >
      <pre
        ref={preRef}
        className="text-m3-on-surface font-mono text-xs leading-[1.35]"
      />
    </div>
  )
}
