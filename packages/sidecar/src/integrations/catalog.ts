import { selectCatalog } from '@sb/core/skills/selection'
import type { SkillCatalogEntry } from '@sb/core/skills/types'
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { projectSkillCatalog } from '../agent-files/project-catalog'
import { assertPlainPath } from '../agent-files/storage'
import { assertIntegrationRevision } from './manifest'

const sourceSchema = z.object({
  root: z.string(),
  origin: z.string(),
  integrationId: z.string().optional(),
  revision: z.string().optional(),
  disabledSkills: z.array(z.string()).default([]),
})

export const integrationCatalogSchema = z.object({
  sources: z.array(sourceSchema).max(96),
  assigned: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        path: z.string(),
        origin: z.string().optional(),
        canonicalDirectory: z.string().optional(),
        error: z.string().optional(),
      }),
    )
    .max(5000)
    .default([]),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(0).max(10_000),
  search: z.string().max(64).optional(),
  characterBudget: z.number().int().nonnegative().optional(),
})

type CatalogInput = z.infer<typeof integrationCatalogSchema>
type CatalogSource = z.infer<typeof sourceSchema>
type Entries = Map<string, SkillCatalogEntry>

/** Merges canonical directories and every origin before search, pagination and hashing. */
export async function integrationSkillCatalog(input: CatalogInput) {
  const entries: Entries = new Map()
  await addAssigned(entries, input.assigned)
  const scans = new Map<string, ReturnType<typeof projectSkillCatalog>>()

  for (const source of input.sources) {
    await mergeSource(entries, source, scans)
  }

  const selection = selectCatalog(input)
  const hash = createHash('sha256')
  const ordered = [...entries]

  for (const [key, entry] of ordered) {
    hash.update(JSON.stringify([key, entry]))
    selection.add(entry)
  }

  return {
    entries: selection.entries,
    total: selection.total(),
    fingerprint: hash.digest('hex'),
  }
}

async function addAssigned(
  entries: Entries,
  assigned: CatalogInput['assigned'],
) {
  for (const entry of assigned) {
    const canonical = entry.canonicalDirectory ?? entry.path
    if (entry.canonicalDirectory) {
      await assertPlainPath(entry.canonicalDirectory)
      const current = await realpath(entry.canonicalDirectory)
      if (current !== entry.canonicalDirectory)
        throw new Error('Skill identity changed')
    }
    entries.set(canonical, { ...entry, origins: [entry.origin ?? 'Agent'] })
  }
}

async function mergeSource(
  entries: Entries,
  source: CatalogSource,
  scans: Map<string, ReturnType<typeof projectSkillCatalog>>,
) {
  if (source.integrationId) {
    await assertIntegrationRevision({
      root: source.root,
      revision: source.revision!,
    })
  }

  const key = path.resolve(source.root)
  if (!scans.has(key)) {
    scans.set(
      key,
      projectSkillCatalog({
        root: source.root,
        label: source.origin,
        offset: 0,
        limit: 5001,
      }),
    )
  }

  const page = await scans.get(key)!
  if (page.total > 5000) {
    throw new Error(
      'Skill catalog exceeds 5,000 entries; no entries were silently discarded',
    )
  }

  for (const entry of page.entries) {
    if (source.disabledSkills.includes(entry.name)) continue
    await mergeEntry(entries, source, entry)
  }
}

async function mergeEntry(
  entries: Entries,
  source: CatalogSource,
  entry: SkillCatalogEntry,
) {
  const canonical = entry.error
    ? entry.path
    : await canonicalSkillDirectory(entry.path)
  const previous = entries.get(canonical)
  const origins = [
    ...new Set([...(previous?.origins ?? []), source.origin]),
  ].sort()

  const uri =
    source.integrationId && !entry.error
      ? `integration://${source.integrationId}/skills/${entry.name}/SKILL.md`
      : (previous?.path ?? entry.path)

  entries.set(canonical, {
    ...entry,
    path: uri,
    canonicalDirectory: canonical,
    origin: origins.join('; '),
    origins,
  })
  if (entries.size > 5000)
    throw new Error('Combined skill catalog exceeds 5,000 entries')
}

async function canonicalSkillDirectory(file: string) {
  await assertPlainPath(file)
  return realpath(path.dirname(file))
}
