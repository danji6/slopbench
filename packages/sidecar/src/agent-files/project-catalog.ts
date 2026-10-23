import { selectCatalog } from '@sb/core/skills/selection'
import type {
  SkillCatalogEntry,
  SkillCatalogSlice,
} from '@sb/core/skills/types'
import { createHash } from 'node:crypto'
import { opendir, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { readSkillMetadata } from './metadata'
import { assertPlainPath, inside, isMissing } from './storage'

export const projectCatalogSchema = z.object({
  root: z.string().min(1),
  label: z.string(),
  agentDir: z.string().optional(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(0).max(10_000),
  search: z.string().max(64).optional(),
  characterBudget: z.number().int().nonnegative().optional(),
})

/** Scans one enabled source, returning bounded entries and a complete digest. */
export async function projectSkillCatalog(
  input: z.infer<typeof projectCatalogSchema>,
): Promise<SkillCatalogSlice> {
  const root = path.resolve(input.root, '.agents', 'skills')
  const selection = selectCatalog(input)
  const hash = createHash('sha256')

  if (input.agentDir && inside(path.resolve(input.agentDir), root)) {
    return { entries: [], total: 0, fingerprint: hash.digest('hex') }
  }

  try {
    await assertPlainPath(root)
    const names = await skillDirectories(root)
    for (const name of names) {
      const entry = await projectEntry(root, name, input.label)
      if (!entry) continue
      hash.update(JSON.stringify(entry))
      selection.add(entry)
    }
  } catch (error) {
    if (!isMissing(error)) {
      const entry = unavailable(root, '.agents/skills', input.label, error)
      hash.update(JSON.stringify(entry))
      selection.add(entry)
    }
  }
  return {
    entries: selection.entries,
    total: selection.total(),
    fingerprint: hash.digest('hex'),
  }
}

async function skillDirectories(root: string) {
  const names: string[] = []
  for await (const entry of await opendir(root)) {
    if (entry.isDirectory() || entry.isSymbolicLink()) names.push(entry.name)
    if (names.length > 5000)
      throw new Error('Project skill directory capacity exceeds 5,000 entries')
  }
  return names.sort()
}

async function projectEntry(
  root: string,
  name: string,
  label: string,
): Promise<SkillCatalogEntry | null> {
  const directory = path.join(root, name)
  try {
    await assertPlainPath(directory)
    if (!(await stat(path.join(directory, 'SKILL.md'))).isFile()) {
      throw new Error('SKILL.md must be a regular file')
    }
    const metadata = await readSkillMetadata(directory)
    if (metadata.name !== name)
      throw new Error('Skill name must match its directory')
    return {
      ...metadata,
      path: path.join(directory, 'SKILL.md'),
      origin: `Project: ${label}`,
    }
  } catch (error) {
    if (isMissing(error)) return null
    return unavailable(directory, name, label, error)
  }
}

function unavailable(
  directory: string,
  name: string,
  label: string,
  error: unknown,
): SkillCatalogEntry {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : undefined
  return {
    name,
    description: '',
    path: path.join(directory, 'SKILL.md'),
    origin: `Project: ${label}`,
    error: code
      ? `Skill files unavailable (${code})`
      : error instanceof Error
        ? error.message.slice(0, 300)
        : 'Skill unavailable',
  }
}
