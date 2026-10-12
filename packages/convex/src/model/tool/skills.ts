import { TOOL_DESCRIPTIONS } from '@sb/core/types'

import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { type Session } from '../../types'

export type SkillsContext = {
  ctx: ActionCtx
  agentId: Id<'agents'>
  workspace: NonNullable<Session['workspace']>
}

export async function createListSkillsTool(skillsCtx: SkillsContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  const { ctx, agentId, workspace } = skillsCtx

  return tool({
    description: TOOL_DESCRIPTIONS.skills,
    inputSchema: z.object({
      search: z.string().max(64).optional(),
      cursor: z.string().max(8192).optional(),
    }),
    execute: async (input) => {
      const { catalogForTool } = await import('../skills/runtime')
      return catalogForTool(ctx, agentId, workspace, input)
    },
  })
}
