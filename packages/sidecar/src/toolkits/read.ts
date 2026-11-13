import {
  MAX_SKILL_NAME_LENGTH,
  SKILL_NAME_PATTERN,
} from '@cv/core/skills/names'
import path from 'node:path'
import { z } from 'zod'

import {
  readSkillResource,
  skillResourceSchema,
} from '../agent-files/read-skill'
import { assertToolkitRevision } from './manifest'

export const toolkitReadSchema = z.object({
  ...skillResourceSchema.shape,
  root: z.string(),
  revision: z.string(),
  name: z.string().regex(SKILL_NAME_PATTERN).max(MAX_SKILL_NAME_LENGTH),
})

/** Reads only a validated enabled skill and its contained resources, with no workspace grant. */
export async function readToolkitSkill(
  input: z.infer<typeof toolkitReadSchema>,
) {
  await assertToolkitRevision(input)
  const directory = path.join(input.root, '.agents', 'skills', input.name)
  const result = await readSkillResource(directory, input)
  return { ...result, origin: 'toolkit' }
}
