import { catalogEntryText } from './catalog'
import type { SkillCatalogEntry } from './types'

export type CatalogSelection = {
  offset: number
  limit: number
  search?: string
  characterBudget?: number
}

/** Selects a bounded window while allowing the caller to hash the full catalog. */
export function selectCatalog(input: CatalogSelection) {
  const entries: SkillCatalogEntry[] = []
  let total = 0
  let characters = 0
  let full = false
  const search = input.search?.toLowerCase() ?? ''

  function add(entry: SkillCatalogEntry) {
    if (search && !entry.name.toLowerCase().includes(search)) return
    const index = total++
    if (index < input.offset || full) return
    const size = catalogEntryText(entry).length + 1
    full =
      entries.length >= input.limit ||
      characters + size > (input.characterBudget ?? Infinity)
    if (full) return
    entries.push(entry)
    characters += size
  }

  return { entries, add, total: () => total, characters: () => characters }
}
