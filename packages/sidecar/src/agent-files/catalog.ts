import type { z } from 'zod'

import { withAgentFiles } from './access'
import { readSkillMetadata } from './metadata'
import { skillCopy } from './operations'
import type { catalogSchema } from './schemas'
import { resolveHome } from './storage'

export async function skillMetadata(input: z.infer<typeof catalogSchema>) {
  return withAgentFiles(input.homeId ?? input.agentId, async () => {
    const home = await resolveHome(
      input.ownerId,
      input.originAgentId ?? input.agentId,
      input.path,
    )
    const entries = []
    for (const name of input.names) {
      const absolutePath = skillCopy(home, name)
      const relativePath = `.agents/skills/${name}/SKILL.md`
      try {
        const metadata = await readSkillMetadata(absolutePath)
        if (metadata.name !== name) {
          throw new Error('Skill name must match its directory')
        }
        entries.push({
          ...metadata,
          path: relativePath,
          absolutePath: `${absolutePath}/SKILL.md`,
        })
      } catch (error) {
        entries.push({
          name,
          description: '',
          path: relativePath,
          error:
            error instanceof Error
              ? error.message
              : 'Skill metadata unavailable',
        })
      }
    }
    return { entries }
  })
}
