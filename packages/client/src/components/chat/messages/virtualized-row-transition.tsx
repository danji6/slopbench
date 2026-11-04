import type {
  RowTransition,
  createRowExpansionStore,
} from '@/lib/chat/row-expansion-state'
import { cn } from '@/lib/utils'
import { type ReactNode, useLayoutEffect, useSyncExternalStore } from 'react'

import { usePendingMessageLayout } from './message-list/message-list-context'

/** Animates each measured child without adding another scrolling container. */
export function VirtualizedRowTransition({
  state,
  children,
}: {
  state?: RowTransition['phase']
  children: ReactNode
}) {
  usePendingMessageLayout(!!state)
  const collapsed = state === 'closing' || state === 'preparing'
  return (
    <div
      data-slot="virtualized-row-transition"
      data-state={state}
      inert={collapsed}
      className={cn(
        'grid',
        (state === 'opening' || state === 'closing') &&
          'transition-[grid-template-rows,opacity,translate] duration-200 ease-in-out motion-reduce:transition-none',
        collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
        state === 'preparing' && '-translate-y-2 opacity-0',
      )}
    >
      <div className={cn('min-h-0', state && 'overflow-hidden')}>
        {children}
      </div>
    </div>
  )
}

/** Lets children mount and Virtua measure them before starting the reveal. */
export function useRowTransitions(
  store: ReturnType<typeof createRowExpansionStore>,
) {
  const transitions = useSyncExternalStore(
    store.subscribe,
    store.getTransitions,
  )
  useLayoutEffect(() => {
    const preparing = [...transitions].filter(
      ([, transition]) => transition.phase === 'preparing',
    )
    if (!preparing.length) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        for (const [id, transition] of preparing)
          store.startOpening(id, transition)
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [store, transitions])
  return transitions
}

/** Limits closing animations to mounted rows and respects reduced motion. */
export function getMountedTransitionRows(
  attribute: 'data-work-id' | 'data-note-group-id',
  id: string,
) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  return new Set(
    Array.from(
      document.querySelectorAll<HTMLElement>(
        `[${attribute}="${CSS.escape(id)}"]`,
      ),
      (element) => element.dataset.rowKey!,
    ),
  )
}
