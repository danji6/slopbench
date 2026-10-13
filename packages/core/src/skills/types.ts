/** A personal directory resolved across authenticated server boundaries. */
export type AgentHome = {
  agentId: string
  homeId?: string
  originAgentId?: string
  ownerId: string
  path: string
  revision: number
}

export type SkillMetadata = {
  name: string
  description: string
}

export type SkillImportCandidate = {
  path: string
  metadata?: SkillMetadata
  error?: string
}

export type SkillImportPage = {
  entries: (SkillImportCandidate & { nextCursor: number })[]
  nextCursor: number
  isDone: boolean
}

export type SkillImportSummary = {
  installed: number
  skipped: number
  failed: number
}

export type SkillCatalogEntry = SkillMetadata & {
  path: string
  absolutePath?: string
  error?: string
}

export type SkillCatalogPage = {
  entries: SkillCatalogEntry[]
  cursor: string | null
  isDone: boolean
}

/** Limits for pages and model reads. */
export const SKILL_PAGE_SIZE = 20
export const SKILL_HEADER_READ_BYTES = 50_000
