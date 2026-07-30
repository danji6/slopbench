import { cn } from '@/lib/utils'
import { Suspense, lazy } from 'react'

import type { TerminalProps } from './terminal-view'

export type { TerminalHandle, TerminalProps } from './terminal-view'

/** The terminal's box, shared with the Suspense fallback to keep the layout stable */
export const TERMINAL_BOX = 'h-72 overflow-hidden'

const TerminalView = lazy(() =>
  import('./terminal-view').then((module) => ({
    default: module.TerminalView,
  })),
)

/**
 * Lazy boundary for the xterm.js terminal. Keeps xterm.js and its CSS in a
 * separate chunk that only loads when a terminal is actually rendered.
 */
export function Terminal(props: TerminalProps) {
  return (
    <Suspense fallback={<div className={cn(TERMINAL_BOX, props.className)} />}>
      <TerminalView {...props} />
    </Suspense>
  )
}
