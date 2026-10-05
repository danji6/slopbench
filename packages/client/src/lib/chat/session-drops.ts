import type { SessionListItem } from './types'

type GroupPage = { results: SessionListItem[]; status: string }

export type SessionDrop = {
  item: SessionListItem
  source: string
  target: string
  settled: boolean
}

/** Validates a drop and describes its optimistic membership change. */
export function createSessionDrop(
  item: SessionListItem,
  target: string,
  folder?: { _id: string; name: string; icon?: string; sources?: unknown[] },
): SessionDrop | null {
  const source = sessionGroupKey(item)

  if (
    source === target ||
    (target !== 'pinned' &&
      ((!item.owned && !!folder?.sources?.length) ||
        (!folder && target !== 'ungrouped')))
  ) {
    return null
  }

  const moved =
    target === 'pinned'
      ? { ...item, pinned: true }
      : {
          ...item,
          pinned: undefined,
          folderId: folder?._id,
          folderName: folder?.name,
          folderIcon: folder?.icon,
        }

  return { item: moved, source, target, settled: false }
}

export function sessionGroupKey(item: SessionListItem): string {
  return item.pinned ? 'pinned' : (item.folderId ?? 'ungrouped')
}

const activity = (item: SessionListItem) =>
  item.lastMessageAt ?? item._creationTime

/** Keeps the local move until both independently paginated groups catch up. */
export function sessionDropConfirmed(
  drop: SessionDrop,
  pages: Record<string, GroupPage>,
): boolean {
  if (!drop.settled) return false

  const source = pages[drop.source]
  const target = pages[drop.target]

  if (source?.results.some((item) => item._id === drop.item._id)) return false
  if (!target) return true // the group is no longer mounted, e.g. during search
  if (target.results.some((item) => item._id === drop.item._id)) return true

  const last = target.results.at(-1)
  // An older moved row can fall beyond the loaded destination page
  return (
    target.status === 'CanLoadMore' &&
    !!last &&
    activity(drop.item) < activity(last)
  )
}

/** Projects pending drops without changing server pages or pagination controls. */
export function projectSessionDrops<T extends GroupPage>(
  pages: Record<string, T>,
  drops: SessionDrop[],
): Record<string, T> {
  if (!drops.length) return pages
  const byId = new Map(drops.map((drop) => [drop.item._id, drop]))
  const currentById = new Map(
    Object.values(pages).flatMap((page) =>
      page.results.map((item) => [item._id, item] as const),
    ),
  )
  return Object.fromEntries(
    Object.entries(pages).map(([key, page]) => {
      const results = page.results.flatMap((item) => {
        const drop = byId.get(item._id)
        if (!drop) return [item]
        return key === 'search' ? [{ ...item, ...folderFields(drop.item) }] : []
      })
      for (const drop of drops) {
        if (drop.target !== key) continue
        const current = currentById.get(drop.item._id) ?? drop.item
        results.push({ ...current, ...folderFields(drop.item) })
      }
      if (key !== 'search') results.sort((a, b) => activity(b) - activity(a))
      return [key, { ...page, results }]
    }),
  )
}

function folderFields(item: SessionListItem) {
  const { folderId, folderName, folderIcon, pinned } = item
  return { folderId, folderName, folderIcon, pinned }
}
