import type { SkillCatalogEntry } from './types'

export const SKILL_CATALOG_CHARACTERS = 10_000
export const SKILL_DESCRIPTION_CHARACTERS = 1_000

export function compactDescription(value: string) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= SKILL_DESCRIPTION_CHARACTERS
    ? text
    : `${text.slice(0, SKILL_DESCRIPTION_CHARACTERS - 1).trimEnd()}…`
}

export function catalogEntryText(entry: SkillCatalogEntry) {
  const name = entry.origin ? `${entry.name} [${entry.origin}]` : entry.name
  if (entry.error)
    return `- ${name}: unavailable (${compactDescription(entry.error)}).`
  const description = `- ${name}: ${compactDescription(entry.description)}`
  return entry.skill_id ? `${description}\n  ${entry.skill_id}` : description
}
