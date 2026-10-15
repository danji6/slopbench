import type { SessionListItem } from '@/lib/chat'
import {
  type FolderNode,
  folderSiblings,
  orderedFolderTree,
} from '@sb/core/utils/folder-tree'

type GroupRowMetadata = {
  depth?: number
  ancestorIds?: string[]
  folderAncestorIds?: string[]
  last?: boolean
  endingFolderIds?: string[]
}

export type GroupRow = (
  | { kind: 'header'; key: string }
  | { kind: 'session'; key: string; id: string }
  | { kind: 'footer'; key: string }
  | { kind: 'separator'; key: string }
) &
  GroupRowMetadata

/** Flattens independently paginated groups into one virtualized sidebar. */
export function flattenSessionGroups(
  keys: string[],
  pages: Record<string, { results: SessionListItem[]; status: string }>,
  collapsed: Record<string, boolean>,
): GroupRow[] {
  const seen = new Set<string>()
  return keys.flatMap((key): GroupRow[] => {
    const page = pages[key]

    const rows: GroupRow[] =
      key === 'search'
        ? []
        : [
            {
              kind: key === 'ungrouped' ? 'separator' : 'header',
              key,
            },
          ]

    const collapsible = key !== 'search' && key !== 'ungrouped'
    if (collapsed[key] && collapsible) return rows

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
  const rows: GroupRow[] = [{ kind: 'header', key: 'pinned', last: false }]

  const seen = new Set<string>(
    (pages.pinned?.results ?? []).map((item) => item._id),
  )

  const tree = orderedFolderTree(folders)

  const displayedFolders = tree.map(({ folder }) => ({
    ...folder,
    parentId: folder.pinned ? 'pinned' : folder.parentId,
  }))

  function appendSessions(key: string, meta: GroupRowMetadata = {}) {
    const flattened = flattenSessionGroups([key], pages, {}).filter(
      (row) => row.kind !== 'header',
    )
    for (const row of flattened) {
      if (row.kind === 'session') {
        if (key !== 'pinned' && seen.has(row.id)) continue
        seen.add(row.id)
      }
      rows.push({ ...row, ...meta })
    }
  }

  function appendFolder(folder: FolderNode, ancestorIds: string[]) {
    const meta = {
      depth: ancestorIds.length,
      ancestorIds,
      folderAncestorIds: tree.find((entry) => entry.folder._id === folder._id)!
        .ancestorIds,
      last: false,
    }

    rows.push({ kind: 'header', key: folder._id, ...meta })

    if (!collapsed[folder._id]) {
      visit(folder._id, [...ancestorIds, folder._id])
      appendSessions(folder._id, meta)
    }

    const end = rows[rows.length - 1]!
    end.last = true
    end.endingFolderIds = [...(end.endingFolderIds ?? []), folder._id]
  }

  function visit(parentId?: string, ancestorIds: string[] = []) {
    // Pinned roots retain the complete tree's order across different parents.
    const siblings =
      parentId === 'pinned'
        ? displayedFolders.filter((folder) => folder.pinned)
        : folderSiblings(displayedFolders, parentId)
    for (const folder of siblings) appendFolder(folder, ancestorIds)
  }

  if (!collapsed.pinned) {
    visit('pinned', ['pinned'])
    appendSessions('pinned')
  }
  const pinnedEnd = rows[rows.length - 1]!
  pinnedEnd.last = true
  pinnedEnd.endingFolderIds = [...(pinnedEnd.endingFolderIds ?? []), 'pinned']
  visit()
  appendSessions('ungrouped')

  return rows
}
