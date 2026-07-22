export type PromptOrderRef = { kind: 'own' | 'global' | 'library'; id: string }

export type PromptMergeInput<OwnItem, GlobalItem> = {
  ownItems: OwnItem[]
  globalItems: GlobalItem[]
  libraryItems?: GlobalItem[]
  order: PromptOrderRef[]
  getOwnId: (item: OwnItem) => string
  getGlobalId: (item: GlobalItem) => string
}

export type PromptMergeEntry<OwnItem, GlobalItem> =
  | { kind: 'own'; item: OwnItem }
  | { kind: 'global'; item: GlobalItem }
  | { kind: 'library'; item: GlobalItem }

export type PromptMergeResult<OwnItem, GlobalItem> = {
  items: PromptMergeEntry<OwnItem, GlobalItem>[]
  order: PromptOrderRef[]
  changed: boolean
}

export function mergeOrderedPromptItems<OwnItem, GlobalItem>({
  ownItems,
  globalItems,
  libraryItems = [],
  order,
  getOwnId,
  getGlobalId,
}: PromptMergeInput<OwnItem, GlobalItem>): PromptMergeResult<
  OwnItem,
  GlobalItem
> {
  const globalById = new Map(
    globalItems.map((item) => [getGlobalId(item), item]),
  )
  const libraryById = new Map(
    libraryItems.map((item) => [getGlobalId(item), item]),
  )
  const ownById = new Map(ownItems.map((item) => [getOwnId(item), item]))
  const ownIndexById = new Map(
    ownItems.map((item, index) => [getOwnId(item), index]),
  )
  const orderedOwnIds = new Set(
    order.filter((ref) => ref.kind === 'own').map((ref) => ref.id),
  )
  const seenGlobalIds = new Set<string>()
  const seenOwnIds = new Set<string>()
  const staleKeys = new Set<string>()
  const resolved: PromptMergeEntry<OwnItem, GlobalItem>[] = []
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
    if (ref.kind === 'global') {
      const item = globalById.get(ref.id)
      if (!item) {
        staleKeys.add(key)
        continue
      }
      seenGlobalIds.add(ref.id)
      resolved.push({ kind: 'global', item })
      continue
    }

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

  const newGlobals = globalItems.filter(
    (item) => !seenGlobalIds.has(getGlobalId(item)),
  )
  pushUnorderedOwnBefore(ownItems.length)

  const items: PromptMergeEntry<OwnItem, GlobalItem>[] = [
    ...newGlobals.map((item): PromptMergeEntry<OwnItem, GlobalItem> => ({
      kind: 'global',
      item,
    })),
    ...resolved,
  ]
  const cleanedOrder = items.map((entry): PromptOrderRef => ({
    kind: entry.kind,
    id: entry.kind === 'own' ? getOwnId(entry.item) : getGlobalId(entry.item),
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
