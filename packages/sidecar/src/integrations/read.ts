import {
  MAX_SKILL_NAME_LENGTH,
  SKILL_NAME_PATTERN,
} from '@sb/core/skills/names'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { readSkillMetadata } from '../agent-files/metadata'
import { assertPlainPath, inside } from '../agent-files/storage'
import { readTextPage } from '../files/read-text'
import { assertIntegrationRevision } from './manifest'

export const integrationReadSchema = z.object({
  root: z.string(),
  revision: z.string(),
  name: z.string().regex(SKILL_NAME_PATTERN).max(MAX_SKILL_NAME_LENGTH),
  resource: z.string().max(4096).default('SKILL.md'),
  offset: z.number().int().nonnegative().default(0),
  length: z.number().int().min(1).max(50_000).default(50_000),
})

/** Reads only a validated enabled skill and its contained resources, with no workspace grant. */
export async function readIntegrationSkill(
  input: z.infer<typeof integrationReadSchema>,
) {
  await assertIntegrationRevision(input)
  const directory = path.join(input.root, '.agents', 'skills', input.name)
  const filename = path.resolve(directory, input.resource)
  if (!inside(directory, filename)) {
    throw new Error('Resource must remain inside this skill')
  }

  await assertPlainPath(filename)
  const root = await realpath(directory)
  if (!inside(root, await realpath(filename))) {
    throw new Error('Resource escaped the skill directory')
  }

  const metadata = await readSkillMetadata(root)
  if (metadata.name !== input.name) {
    throw new Error('Skill name must match its directory')
  }

  const info = await stat(filename)
  if (!info.isFile()) {
    throw new Error('Skill resource must be a regular file')
  }

  const size = info.size
  const result = await readTextPage(filename, {
    byteOffset: input.offset,
    maxBytes: input.length,
  })

  // The shared reader handles UTF-8 boundaries and binary rejection
  return {
    ...result,
    size,
    untrusted: true,
    origin: 'integration',
    readOnly: true,
  }
}
