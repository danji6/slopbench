import type { SessionListItem } from '@/lib/chat'

export type GroupRow =
  | { kind: 'header'; key: string }
  | { kind: 'session'; key: string; id: string }
  | { kind: 'footer'; key: string }

/** Flattens independently paginated groups into one virtualized sidebar. */
export function flattenSessionGroups(
  keys: string[],
  pages: Record<string, { results: SessionListItem[]; status: string }>,
  collapsed: Record<string, boolean>,
  dragging = false,
): GroupRow[] {
  const seen = new Set<string>()
  return keys.flatMap((key): GroupRow[] => {
    const page = pages[key]
    if (
      !dragging &&
      (key === 'pinned' || key === 'shared') &&
      page?.status === 'Exhausted' &&
      !page.results.length
    ) {
      return []
    }

    const rows: GroupRow[] = key === 'search' ? [] : [{ kind: 'header', key }]
    if (collapsed[key] && key !== 'search') return rows

    for (const session of page?.results ?? []) {
      if (seen.has(session._id)) continue
      seen.add(session._id)
      rows.push({ kind: 'session', key, id: session._id })
    }
    if (!page || page.status !== 'Exhausted' || !page.results.length)
      rows.push({ kind: 'footer', key })

    return rows
  })
}
