import { sha256 } from '@sb/core/sha256'
import {
  SKILL_CATALOG_CHARACTERS,
  catalogEntryText,
} from '@sb/core/skills/catalog'
import { selectCatalog } from '@sb/core/skills/selection'
import { SKILL_PAGE_SIZE } from '@sb/core/skills/types'
import type {
  SkillCatalogEntry,
  SkillCatalogPage,
  SkillCatalogSlice,
} from '@sb/core/skills/types'

export type CatalogRequest = {
  cursor?: string | null
  search?: string
  compact?: boolean
}

const EMPTY_CATALOG_FINGERPRINT =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** Accumulates a bounded window and hashes every source, including omitted entries. */
export class CatalogWindow {
  private readonly cursor: ReturnType<typeof parseCursor>
  private readonly limit: number
  private readonly budget?: number
  private readonly selection: ReturnType<typeof selectCatalog>
  private fingerprint: string
  private projectTotal = 0
  private projectCharacters = 0

  constructor(
    agentId: string,
    private readonly input: CatalogRequest,
  ) {
    this.cursor = parseCursor(input.cursor, input.search)
    this.limit = input.compact ? SKILL_CATALOG_CHARACTERS : SKILL_PAGE_SIZE
    this.budget = input.compact ? SKILL_CATALOG_CHARACTERS - 1000 : undefined
    this.selection = selectCatalog({
      offset: this.cursor.offset,
      search: input.search,
      limit: this.limit,
      characterBudget: this.budget,
    })
    this.fingerprint = agentId
  }

  private total() {
    return this.selection.total() + this.projectTotal
  }

  async addAssigned(entry: SkillCatalogEntry) {
    this.fingerprint = await sha256(JSON.stringify([this.fingerprint, entry]))
    this.selection.add(entry)
  }

  sourceOptions() {
    const blocked =
      this.cursor.offset + this.selection.entries.length < this.total()
    return {
      offset: Math.max(0, this.cursor.offset - this.total()),
      search: this.input.search,
      limit: blocked
        ? 0
        : Math.max(0, this.limit - this.selection.entries.length),
      characterBudget: this.remainingBudget(),
    }
  }

  private remainingBudget() {
    if (this.budget === undefined) return undefined
    return Math.max(
      0,
      this.budget - this.selection.characters() - this.projectCharacters,
    )
  }

  async addProject(page: SkillCatalogSlice) {
    if (page.fingerprint !== EMPTY_CATALOG_FINGERPRINT)
      this.fingerprint = await sha256(
        JSON.stringify([this.fingerprint, page.fingerprint]),
      )
    this.selection.entries.push(...page.entries)
    this.projectCharacters += page.entries.reduce(
      (size, entry) => size + catalogEntryText(entry).length + 1,
      0,
    )
    this.projectTotal += page.total
  }

  async finish(): Promise<SkillCatalogPage> {
    const fingerprint = await sha256(this.fingerprint)
    if (this.cursor.fingerprint && this.cursor.fingerprint !== fingerprint) {
      throw new Error(
        'Skill catalog changed. Restart list_skills without a cursor.',
      )
    }
    const offset = this.cursor.offset + this.selection.entries.length
    const isDone = offset >= this.total()
    return {
      entries: this.selection.entries,
      fingerprint,
      isDone,
      cursor: isDone
        ? null
        : JSON.stringify({
            offset,
            fingerprint,
            search: this.input.search ?? '',
          }),
    }
  }
}

function parseCursor(value: string | null | undefined, search = '') {
  if (!value) return { offset: 0, fingerprint: undefined }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const offset = Number(parsed.offset)
    const validOffset = Number.isSafeInteger(offset) && offset >= 0
    const matchingRequest =
      typeof parsed.fingerprint === 'string' && parsed.search === search
    if (!validOffset || !matchingRequest) throw new Error('Invalid cursor')
    return { offset, fingerprint: parsed.fingerprint }
  } catch {
    throw new Error(
      'Invalid skill cursor. Restart list_skills without a cursor.',
    )
  }
}
