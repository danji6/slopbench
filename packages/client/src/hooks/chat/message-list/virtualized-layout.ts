import {
  MAX_COLLAPSED_ROW_HEIGHT,
  type RowTransition,
} from '@/lib/chat/row-expansion-state'
import type { MessageRow } from '@/lib/chat/rows'
import { shiftsOnlyAtStart } from '@/lib/chat/window-row-shift'
import { type RefObject, useCallback, useLayoutEffect, useState } from 'react'
import type { WindowVirtualizerHandle } from 'virtua'

type VirtualizedLayoutOptions = {
  rows: readonly MessageRow[]
  transitions: ReadonlyMap<string, RowTransition>
  virtualizer: RefObject<WindowVirtualizerHandle | null>
}

type VirtualizedLayout = {
  rows: readonly MessageRow[]
  transitions: ReadonlyMap<string, RowTransition>
  shift: boolean
  minHeight: number
}

/** Keeps retained rows from losing their measured space during interior deletions. */
export function useVirtualizedLayout({
  rows,
  transitions,
  virtualizer,
}: VirtualizedLayoutOptions) {
  const [layout, setLayout] = useState<VirtualizedLayout>({
    rows,
    transitions,
    shift: false,
    minHeight: 0,
  })
  if (layout.rows !== rows || layout.transitions !== transitions) {
    const { shift, minHeight } = nextLayout(layout, rows, virtualizer.current)
    setLayout({ rows, transitions, shift, minHeight })
  }

  const onResize = useCallback(() => {
    const instance = virtualizer.current
    if (!instance || !layout.minHeight) return
    const height = layout.rows.reduce(
      (height, _, index) => height + instance.getItemSize(index),
      0,
    )
    if (height >= layout.minHeight - 1) {
      setLayout((current) =>
        current === layout ? { ...current, minHeight: 0 } : current,
      )
    }
  }, [layout, virtualizer])

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(onResize)
    return () => cancelAnimationFrame(frame)
  }, [onResize])

  return {
    shift: layout.shift,
    minHeight: layout.minHeight || undefined,
    onResize,
  }
}

/** Preserves known retained heights until Virtua replaces its index-based cache. */
function nextLayout(
  previous: VirtualizedLayout,
  rows: readonly MessageRow[],
  virtualizer: WindowVirtualizerHandle | null,
) {
  const shift = shiftsOnlyAtStart(previous.rows, rows)
  if (rows.length === previous.rows.length) {
    const sameKeys = rows.every(
      (row, index) => row.key === previous.rows[index].key,
    )
    return { shift, minHeight: sameKeys ? previous.minHeight : 0 }
  }
  if (rows.length > previous.rows.length || shift || !virtualizer) {
    return { shift, minHeight: 0 }
  }

  const retained = new Set(rows.map((row) => row.key))
  const closingKeys = new Set(
    [...previous.transitions.values()].flatMap((transition) =>
      transition.phase === 'closing' ? [...transition.mountedRows] : [],
    ),
  )
  const canPreserveRetainedHeight = previous.rows.every((row, index) => {
    return (
      retained.has(row.key) ||
      closingKeys.has(row.key) ||
      virtualizer.getItemSize(index) <= MAX_COLLAPSED_ROW_HEIGHT
    )
  })
  const minHeight = canPreserveRetainedHeight
    ? previous.rows.reduce((height, row, index) => {
        return retained.has(row.key)
          ? height + virtualizer.getItemSize(index)
          : height
      }, 0)
    : 0
  return { rows, shift, minHeight }
}
