import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { readTextPage } from '../files/read-text'
import { withAgentFiles } from './access'
import { readSkillMetadata } from './metadata'
import { skillCopy } from './operations'
import { homeSchema } from './schemas'
import { assertPlainPath, inside, resolveHome } from './storage'

export const skillResourceSchema = z.object({
  resource: z.string().max(4096).default('SKILL.md'),
  offset: z.number().int().nonnegative().default(0),
  length: z.number().int().min(1).max(50_000).default(50_000),
})

export const assignedSkillReadSchema = homeSchema.extend({
  ...skillResourceSchema.shape,
  name: z.string(),
  path: z.string().min(1),
})

type SkillResource = z.infer<typeof skillResourceSchema> & { name: string }

/** Reads a text page only from the addressed skill directory. */
export async function readSkillResource(
  directory: string,
  input: SkillResource,
) {
  const filename = path.resolve(directory, input.resource)
  if (filename === directory || !inside(directory, filename))
    throw new Error('Resource must remain inside this skill')

  await assertPlainPath(filename)
  const root = await realpath(directory)
  if (!inside(root, await realpath(filename)))
    throw new Error('Resource escaped the skill directory')

  const metadata = await readSkillMetadata(root)
  if (metadata.name !== input.name)
    throw new Error('Skill name must match its directory')

  const info = await stat(filename)
  if (!info.isFile()) throw new Error('Skill resource must be a regular file')

  const result = await readTextPage(filename, {
    byteOffset: input.offset,
    maxBytes: input.length,
  })
  return { ...result, size: info.size, untrusted: true, readOnly: true }
}

/** Holds the home read lock for the duration of the bounded read. */
export async function readAssignedSkill(
  input: z.infer<typeof assignedSkillReadSchema>,
) {
  return withAgentFiles(input.homeId ?? input.agentId, async () => {
    const home = await resolveHome(
      input.ownerId,
      input.originAgentId ?? input.agentId,
      input.path,
    )
    const result = await readSkillResource(skillCopy(home, input.name), input)
    return { ...result, origin: 'agent' }
  })
}
