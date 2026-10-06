import type { SessionListItem } from '@/lib/chat'
import {
  type FolderNode,
  folderSiblings,
  folderTrail,
} from '@sb/core/utils/folder-tree'

export type GroupRow = (
  | { kind: 'header'; key: string }
  | { kind: 'session'; key: string; id: string }
  | { kind: 'footer'; key: string }
) & {
  depth?: number
  ancestorIds?: string[]
  last?: boolean
  endingFolderIds?: string[]
}

/** Flattens independently paginated groups into one virtualized sidebar. */
export function flattenSessionGroups(
  keys: string[],
  pages: Record<string, { results: SessionListItem[]; status: string }>,
  collapsed: Record<string, boolean>,
): GroupRow[] {
  const seen = new Set<string>()
  return keys.flatMap((key): GroupRow[] => {
    const page = pages[key]

    const rows: GroupRow[] = key === 'search' ? [] : [{ kind: 'header', key }]
    if (collapsed[key] && key !== 'search') return rows

    for (const session of page?.results ?? []) {
      if (seen.has(session._id)) continue
      seen.add(session._id)
      rows.push({ kind: 'session', key, id: session._id })
    }
    if (
      !page ||
      page.status !== 'Exhausted' ||
      (key === 'search' && !page.results.length)
    ) {
      rows.push({ kind: 'footer', key })
    }

    return rows
  })
}

/** Keeps child branches ahead of independently paginated direct sessions. */
export function flattenSessionTree(
  folders: FolderNode[],
  pages: Parameters<typeof flattenSessionGroups>[1],
  collapsed: Record<string, boolean>,
): GroupRow[] {
  const rows = flattenSessionGroups(['pinned'], pages, collapsed)
  const seen = new Set(rows.flatMap((row) => (row.kind === 'session' ? [row.id] : []))) // prettier-ignore

  function visit(parentId?: string) {
    for (const folder of folderSiblings(folders, parentId)) {
      const trail = folderTrail(folders, folder._id)
      const meta = {
        depth: trail.length - 1,
        ancestorIds: trail.slice(0, -1).map((f) => f._id),
        last: false,
      }
      const start = rows.length

      rows.push({ kind: 'header', key: folder._id, ...meta })

      if (!collapsed[folder._id]) {
        visit(folder._id)
        const flattened = flattenSessionGroups([folder._id], pages, {}).filter(
          (row) => row.kind !== 'header',
        )
        for (const row of flattened) {
          if (row.kind === 'session') {
            if (seen.has(row.id)) continue
            seen.add(row.id)
          }
          rows.push({ ...row, ...meta })
        }
      }
      if (rows.length > start) {
        const end = rows[rows.length - 1]!
        end.last = true
        end.endingFolderIds = [...(end.endingFolderIds ?? []), folder._id]
      }
    }
  }

  visit()
  rows.push(
    ...flattenSessionGroups(['ungrouped'], pages, collapsed).filter(
      (row) => row.kind !== 'session' || !seen.has(row.id),
    ),
  )

  return rows
}
