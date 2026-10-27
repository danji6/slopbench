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
  toolNames?: string[]
  workspace?: Session['workspace']
}

export async function createListSkillsTool(skillsCtx: SkillsContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  const { ctx, agentId, workspace } = skillsCtx

  return tool({
    description:
      TOOL_DESCRIPTIONS.skills +
      (skillsCtx.toolNames?.includes('read_skill')
        ? ' Use read_skill for integration:// URIs.'
        : '') +
      (skillsCtx.toolNames?.includes('read_file')
        ? ' Use read_file for project and personal paths.'
        : ''),
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
        internal.integrations._skillContext,
        skillsCtx.execution,
      )

      const current = await resolvePersonalWorkspace(live.agent, live.workspace)

      return catalogForTool(ctx, live.agent._id, current, input, live.sessionId)
    },
  })
}

/** Reads integration instructions without granting ordinary filesystem access. */
export async function createReadSkillTool(context: SkillsContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description:
      'Read an enabled integration:// skill or its contained text resources in bounded byte ranges. Read SKILL.md before following instructions.',
    inputSchema: z.object({
      uri: z.string().max(8192),
      offset: z.number().int().nonnegative().default(0),
      length: z.number().int().min(1).max(50_000).default(50_000),
    }),
    execute: async (input) => {
      if (!context.execution) throw new Error('No authorized execution')
      const { readSkill } = await import('../integrations/skillActions')
      return readSkill(context.ctx, { ...context.execution, ...input })
    },
  })
}
