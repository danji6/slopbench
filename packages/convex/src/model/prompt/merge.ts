export type PromptOrderRef = { kind: 'own' | 'library'; id: string }

export type PromptMergeInput<OwnItem, LibraryItem> = {
  ownItems: OwnItem[]
  libraryItems?: LibraryItem[]
  order: PromptOrderRef[]
  getOwnId: (item: OwnItem) => string
  getLibraryId: (item: LibraryItem) => string
}

export type PromptMergeEntry<OwnItem, LibraryItem> =
  { kind: 'own'; item: OwnItem } | { kind: 'library'; item: LibraryItem }

export type PromptMergeResult<OwnItem, LibraryItem> = {
  items: PromptMergeEntry<OwnItem, LibraryItem>[]
  order: PromptOrderRef[]
  changed: boolean
}

export function mergeOrderedPromptItems<OwnItem, LibraryItem>({
  ownItems,
  libraryItems = [],
  order,
  getOwnId,
  getLibraryId,
}: PromptMergeInput<OwnItem, LibraryItem>): PromptMergeResult<
  OwnItem,
  LibraryItem
> {
  const libraryById = new Map(
    libraryItems.map((item) => [getLibraryId(item), item]),
  )
  const ownById = new Map(ownItems.map((item) => [getOwnId(item), item]))
  const ownIndexById = new Map(
    ownItems.map((item, index) => [getOwnId(item), index]),
  )
  const orderedOwnIds = new Set(
    order.filter((ref) => ref.kind === 'own').map((ref) => ref.id),
  )
  const seenOwnIds = new Set<string>()
  const staleKeys = new Set<string>()
  const resolved: PromptMergeEntry<OwnItem, LibraryItem>[] = []
  let nextOwnIndex = 0

  function pushUnorderedOwnBefore(index: number) {
    while (nextOwnIndex < index) {
      const item = ownItems[nextOwnIndex]
      const id = getOwnId(item)
      if (!seenOwnIds.has(id) && !orderedOwnIds.has(id)) {
        seenOwnIds.add(id)
        resolved.push({ kind: 'own', item })
      }
      nextOwnIndex++
    }
  }

  for (const ref of order) {
    const key = `${ref.kind}:${ref.id}`
    if (ref.kind === 'library') {
      const item = libraryById.get(ref.id)
      if (!item) {
        staleKeys.add(key)
        continue
      }
      resolved.push({ kind: 'library', item })
      continue
    }

    const index = ownIndexById.get(ref.id)
    const item = ownById.get(ref.id)
    if (!item || index === undefined) {
      staleKeys.add(key)
      continue
    }
    pushUnorderedOwnBefore(index)
    seenOwnIds.add(ref.id)
    resolved.push({ kind: 'own', item })
    nextOwnIndex = Math.max(nextOwnIndex, index + 1)
  }

  pushUnorderedOwnBefore(ownItems.length)
  const items = resolved
  const cleanedOrder = items.map((entry): PromptOrderRef => ({
    kind: entry.kind,
    id: entry.kind === 'own' ? getOwnId(entry.item) : getLibraryId(entry.item),
  }))
  const changed =
    staleKeys.size > 0 ||
    cleanedOrder.length !== order.length ||
    cleanedOrder.some((ref, index) => {
      const current = order[index]
      return ref.kind !== current.kind || ref.id !== current.id
    })

  return { items, order: cleanedOrder, changed }
}
