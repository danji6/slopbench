import type { TerminalHandle } from '@/components/ui/terminal'
import { computeTerminalFeed } from '@/lib/terminal-feed'
import { type RefObject, useCallback, useEffect, useRef } from 'react'

/**
 * Feeds a terminal from the persisted `term` tail by writing only the bytes
 * past what was already written into the current xterm instance.
 * @returns A callback to clear the terminal and replay the current tail.
 */
export function useTerminalFeed(
  handle: RefObject<TerminalHandle | null>,
  term: string | undefined,
  termOffset: number | undefined,
) {
  const writtenThroughRef = useRef<number | null>(null)
  const feedRef = useRef<(reset?: boolean) => void>(() => {})

  useEffect(() => {
    feedRef.current = (reset = false) => {
      const terminal = handle.current
      if (terminal === null || term === undefined) return

      if (reset) {
        terminal.clear()
        writtenThroughRef.current = null
      }

      const write = computeTerminalFeed(
        writtenThroughRef.current,
        term,
        termOffset ?? 0,
      )
      if (!write) return

      terminal.write(write.data)
      writtenThroughRef.current = write.writtenThrough
    }
    feedRef.current()
  }, [handle, term, termOffset])

  return useCallback(() => {
    feedRef.current(true)
  }, [])
}
