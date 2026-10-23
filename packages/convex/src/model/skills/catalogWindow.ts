import { sha256 } from '@sb/core/sha256'
import { SKILL_CATALOG_CHARACTERS } from '@sb/core/skills/catalog'
import { SKILL_PAGE_SIZE } from '@sb/core/skills/types'
import type { SkillCatalogPage, SkillCatalogSlice } from '@sb/core/skills/types'

export type CatalogRequest = {
  cursor?: string | null
  search?: string
  compact?: boolean
}

/** Validates continuation against the complete merged metadata, including entries outside the page. */
export class CatalogWindow {
  private readonly cursor: ReturnType<typeof parseCursor>
  constructor(
    private readonly agentId: string,
    private readonly input: CatalogRequest,
  ) {
    this.cursor = parseCursor(input.cursor, input.search)
  }

  sourceOptions() {
    return {
      offset: this.cursor.offset,
      search: this.input.search,
      limit: this.input.compact ? SKILL_CATALOG_CHARACTERS : SKILL_PAGE_SIZE,
      characterBudget: this.input.compact
        ? SKILL_CATALOG_CHARACTERS - 1000
        : undefined,
    }
  }

  async finish(page?: SkillCatalogSlice): Promise<SkillCatalogPage> {
    const fingerprint = await sha256(
      JSON.stringify([this.agentId, page?.fingerprint ?? '']),
    )
    const catalogChanged =
      this.cursor.fingerprint && this.cursor.fingerprint !== fingerprint
    if (catalogChanged)
      throw new Error(
        'Skill catalog changed. Restart list_skills without a cursor.',
      )
    const entries = page?.entries ?? []
    const offset = this.cursor.offset + entries.length
    const isDone = offset >= (page?.total ?? 0)
    return {
      entries,
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
