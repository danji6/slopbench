import type { MessageRow } from './rows'

type RowAnchor = { row: MessageRow; top: number }

export type WindowScrollAnchor = readonly RowAnchor[]

/** Returns the content node without the virtualized item's inter-message spacing. */
export function scrollAnchorElement(item: HTMLElement): Element {
  return item.lastElementChild ?? item
}

/** Captures visible content, preferring body rows over movable sender headers. */
export function captureWindowScrollAnchor(
  container: HTMLElement,
  rows: readonly MessageRow[],
  topInset: number,
  viewportHeight: number,
): WindowScrollAnchor {
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const anchors: RowAnchor[] = []
  for (const item of container.querySelectorAll<HTMLElement>(
    '[data-row-key]',
  )) {
    const row = byKey.get(item.dataset.rowKey ?? '')
    if (!row) continue
    const rect = scrollAnchorElement(item).getBoundingClientRect()
    const visible = rect.bottom > topInset && rect.top < viewportHeight
    if (visible && rect.height > 0) anchors.push({ row, top: rect.top })
  }
  const body = anchors.filter(
    ({ row }) => row.kind !== 'header' && row.kind !== 'footer',
  )
  return body.length ? body : anchors
}

/** Finds original content even when sender grouping or work identity changes. */
export function resolveWindowScrollAnchor(
  anchors: WindowScrollAnchor,
  rows: readonly MessageRow[],
): { index: number; top: number } | null {
  for (const anchor of anchors) {
    const index = rows.findIndex((row) => sameContent(anchor.row, row))
    if (index >= 0) return { index, top: anchor.top }
  }
  return null
}

function sameContent(before: MessageRow, after: MessageRow): boolean {
  if (before.messageId !== after.messageId || before.kind !== after.kind) {
    return false
  }
  if (before.kind === 'group' && after.kind === 'group') {
    return (
      before.segmentIndex === after.segmentIndex &&
      before.groupIndex === after.groupIndex
    )
  }
  if (before.kind === 'work' && after.kind === 'work') {
    if (!before.work.toolCallIds.length) return before.work.id === after.work.id
    return before.work.toolCallIds.some((id) =>
      after.work.toolCallIds.includes(id),
    )
  }
  return before.key === after.key
}
