import {
  MAX_COLLAPSED_ROW_HEIGHT,
  type RowTransition,
  type createRowExpansionStore,
} from '@/lib/chat/row-expansion-state'
import type { MessageRow } from '@/lib/chat/rows'
import { cn } from '@/lib/utils'
import {
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useSyncExternalStore,
} from 'react'
import type { WindowVirtualizerHandle } from 'virtua'

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

type TransitionLayout = {
  rows: readonly MessageRow[]
  root: RefObject<HTMLDivElement | null>
  virtualizer: RefObject<WindowVirtualizerHandle | null>
}

/** Coordinates row animations with the virtualizer's measurements. */
export function useRowTransitions(
  store: ReturnType<typeof createRowExpansionStore>,
  layout: TransitionLayout,
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

  useClosingRows(store, transitions, layout)
  return transitions
}

function useClosingRows(
  store: ReturnType<typeof createRowExpansionStore>,
  transitions: ReadonlyMap<string, RowTransition>,
  { rows, root, virtualizer }: TransitionLayout,
) {
  useLayoutEffect(() => {
    let closing = [...transitions].filter(
      ([, transition]) => transition.phase === 'closing',
    )
    const container = root.current
    const instance = virtualizer.current
    if (!closing.length || !container || !instance) return

    const indices = new Map(rows.map((row, index) => [row.key, index]))
    const isSettled = (key: string) =>
      closingRowSettled(container, instance, key, indices.get(key))

    let frame: number
    const check = () => {
      closing = closing.filter(([id, transition]) => {
        if (![...transition.mountedRows].every(isSettled)) return true
        store.finishClosing(id, transition)
        return false
      })
      if (closing.length) frame = requestAnimationFrame(check)
    }
    frame = requestAnimationFrame(check)

    return () => cancelAnimationFrame(frame)
  }, [rows, root, store, transitions, virtualizer])
}

/** An unmounted row has no animation left for the viewport to display. */
function closingRowSettled(
  root: HTMLElement,
  virtualizer: WindowVirtualizerHandle,
  key: string,
  index?: number,
) {
  if (index === undefined) return true

  const row = root.querySelector(
    `[data-row-key="${CSS.escape(key)}"] > [data-slot="virtualized-row-transition"][data-state="closing"]`,
  )
  if (!row) return true
  if (virtualizer.getItemSize(index) > MAX_COLLAPSED_ROW_HEIGHT) return false
  return row
    .getAnimations()
    .every((animation) => animation.playState === 'finished')
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
