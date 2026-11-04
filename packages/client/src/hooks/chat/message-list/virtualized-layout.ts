import type { MessageRow } from '@/lib/chat/rows'
import { shiftsOnlyAtStart } from '@/lib/chat/window-row-shift'
import { type RefObject, useCallback, useLayoutEffect, useState } from 'react'
import type { WindowVirtualizerHandle } from 'virtua'

type VirtualizedLayoutOptions = {
  rows: readonly MessageRow[]
  virtualizer: RefObject<WindowVirtualizerHandle | null>
}

/** Keeps retained rows from losing their measured space during interior deletions. */
export function useVirtualizedLayout({
  rows,
  virtualizer,
}: VirtualizedLayoutOptions) {
  const [layout, setLayout] = useState({ rows, shift: false, minHeight: 0 })
  if (layout.rows !== rows) {
    setLayout(nextLayout(layout.rows, rows, virtualizer.current))
  }

  const onResize = useCallback(() => {
    const instance = virtualizer.current
    if (!instance || !layout.minHeight) return
    const height = rows.reduce(
      (height, _, index) => height + instance.getItemSize(index),
      0,
    )
    if (height >= layout.minHeight - 1) {
      setLayout((current) => ({ ...current, minHeight: 0 }))
    }
  }, [layout.minHeight, rows, virtualizer])

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
  previous: readonly MessageRow[],
  rows: readonly MessageRow[],
  virtualizer: WindowVirtualizerHandle | null,
) {
  const shift = shiftsOnlyAtStart(previous, rows)
  const retained = new Set(rows.map((row) => row.key))
  const removedRowsCollapsed = previous.every((row, index) => {
    return retained.has(row.key) || (virtualizer?.getItemSize(index) ?? 0) <= 1
  })
  const collapsedInteriorRemoval =
    rows.length < previous.length && !shift && removedRowsCollapsed
  const minHeight = collapsedInteriorRemoval
    ? previous.reduce((height, row, index) => {
        return retained.has(row.key)
          ? height + (virtualizer?.getItemSize(index) ?? 0)
          : height
      }, 0)
    : 0
  return { rows, shift, minHeight }
}
