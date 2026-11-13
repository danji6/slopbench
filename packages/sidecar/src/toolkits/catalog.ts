import { isSkillName } from '@cv/core/skills/names'
import { selectCatalog } from '@cv/core/skills/selection'
import type { SkillCatalogEntry } from '@cv/core/skills/types'
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { projectSkillCatalog } from '../agent-files/project-catalog'
import { assertPlainPath, inside } from '../agent-files/storage'
import { assertToolkitRevision } from './manifest'

const sourceSchema = z.object({
  root: z.string(),
  origin: z.string(),
  toolkitId: z.string().optional(),
  projectSourceId: z.string().optional(),
  agentDir: z.string().optional(),
  revision: z.string().optional(),
  disabledSkills: z.array(z.string()).default([]),
})

export const toolkitCatalogSchema = z.object({
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
        revision: z.string().optional(),
      }),
    )
    .max(5000)
    .default([]),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(0).max(10_000),
  search: z.string().max(64).optional(),
  exactName: z.string().refine(isSkillName).optional(),
  characterBudget: z.number().int().nonnegative().optional(),
})

type CatalogInput = z.infer<typeof toolkitCatalogSchema>
type CatalogSource = z.infer<typeof sourceSchema>
type Entries = Map<string, SkillCatalogEntry>

/** Merges canonical directories and every origin before search, pagination and hashing. */
export async function toolkitSkillCatalog(input: CatalogInput) {
  const entries: Entries = new Map()
  await addAssigned(entries, input.assigned)
  const scans = new Map<string, ReturnType<typeof projectSkillCatalog>>()

  for (const source of input.sources) {
    await mergeSource(entries, source, scans, input.exactName)
  }

  const selection = selectCatalog(input)
  const hash = createHash('sha256')
  const ordered = [...entries]

  const availability = {
    skills: false,
  }
  for (const [key, entry] of ordered) {
    if (!entry.error) availability.skills = true
    hash.update(JSON.stringify([key, entry]))
    selection.add(entry)
  }

  return {
    availability,
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
    entries.set(canonical, {
      ...entry,
      origins: [entry.origin ?? 'Agent'],
      ...(!entry.error && { skill_id: `${entry.name}@agent` }),
    })
  }
}

async function mergeSource(
  entries: Entries,
  source: CatalogSource,
  scans: Map<string, ReturnType<typeof projectSkillCatalog>>,
  exactName?: string,
) {
  if (source.toolkitId) {
    await assertToolkitRevision({
      root: source.root,
      revision: source.revision!,
    })
  }

  const key = path.resolve(source.root)
  const projectSkills = path.join(key, '.agents', 'skills')
  if (source.agentDir && inside(path.resolve(source.agentDir), projectSkills))
    return
  if (!scans.has(key)) {
    scans.set(
      key,
      projectSkillCatalog({
        root: source.root,
        label: source.origin,
        offset: 0,
        limit: 5001,
        exactName,
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
  if (source.agentDir && inside(path.resolve(source.agentDir), canonical))
    return
  const previous = entries.get(canonical)
  const origins = [
    ...new Set([...(previous?.origins ?? []), source.origin]),
  ].sort()

  const toolkit = source.toolkitId && !entry.error
  const projectId =
    source.projectSourceId && !entry.error
      ? `${entry.name}@project:${source.projectSourceId}`
      : undefined
  const skillId = toolkit
    ? `${entry.name}@toolkit:${source.toolkitId}`
    : (previous?.skill_id ?? projectId)

  entries.set(canonical, {
    ...entry,
    path: previous?.path ?? entry.path,
    skill_id: skillId,
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
