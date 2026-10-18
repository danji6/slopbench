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
  return entry.error
    ? `- ${entry.name}: unavailable (${compactDescription(entry.error)}).`
    : `- ${entry.name}: ${compactDescription(entry.description)}\n  ${entry.path}`
}

export function catalogCursor(cursor: string | null, offset = 0) {
  const decoded = decodeCatalogCursor(cursor)
  return `skill:${JSON.stringify({ cursor: decoded.cursor, offset: decoded.offset + offset })}`
}

export function decodeCatalogCursor(value: string | null) {
  if (!value?.startsWith('skill:')) return { cursor: value, offset: 0 }
  const parsed = JSON.parse(value.slice(6)) as {
    cursor: unknown
    offset: unknown
  }
  if (
    (parsed.cursor !== null && typeof parsed.cursor !== 'string') ||
    !Number.isInteger(parsed.offset) ||
    Number(parsed.offset) < 0 ||
    Number(parsed.offset) >= 20
  ) {
    throw new Error('Invalid skill catalog cursor')
  }
  return { cursor: parsed.cursor, offset: Number(parsed.offset) }
}
