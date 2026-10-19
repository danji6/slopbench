import { TOOL_DESCRIPTIONS } from '@sb/core/types'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import type { StreamExecutionArgs } from '../../types'
import { type Session } from '../../types'

export type SkillsContext = {
  ctx: ActionCtx
  execution?: StreamExecutionArgs
  agentId: Id<'agents'>
  workspace?: Session['workspace']
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
      const { catalogForTool, resolvePersonalWorkspace } =
        await import('../skills/runtime')

      if (!skillsCtx.execution) {
        if (!workspace) throw new Error('No filesystem context configured')
        return catalogForTool(ctx, agentId, workspace, input)
      }

      const live = await ctx.runQuery(
        internal.streams._getFilesystemContext,
        skillsCtx.execution,
      )

      const current = await resolvePersonalWorkspace(live.agent, live.workspace)
      if (!current) return { entries: [], cursor: null, isDone: true }

      return catalogForTool(ctx, live.agent._id, current, input)
    },
  })
}
