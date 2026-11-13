import { isSkillName } from '@cv/core/skills/names'
import { isPathForbidden } from '@cv/core/workspace/path-policy'
import path from 'node:path'
import { z } from 'zod'

import { withWorkspaceOperation } from '../mcp/workspace/context'
import { readSkillResource, skillResourceSchema } from './read-skill'
import { inside } from './storage'

export const projectSkillReadSchema = skillResourceSchema.extend({
  root: z.string().min(1),
  agentDir: z.string().optional(),
  sessionId: z.string().min(1),
  name: z.string().refine(isSkillName),
})

export async function readProjectSkill(
  input: z.infer<typeof projectSkillReadSchema>,
) {
  const directory = path.resolve(input.root, '.agents', 'skills', input.name)
  if (input.agentDir && inside(path.resolve(input.agentDir), directory))
    throw new Error('Project skill cannot resolve inside the agent home')
  if (isPathForbidden(path.resolve(directory, input.resource)))
    throw new Error('Protected Git paths are unavailable through read_skill')

  const result = await withWorkspaceOperation(input.sessionId, () =>
    readSkillResource(directory, input),
  )
  return { ...result, origin: 'project' }
}
