import { TOOL_DESCRIPTIONS } from '@cv/core/types'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import type { StreamExecutionArgs } from '../../types'

export type SkillsContext = {
  ctx: ActionCtx
  execution: StreamExecutionArgs
  toolNames: string[]
}

export async function createListSkillsTool(skillsCtx: SkillsContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  const { ctx, execution, toolNames } = skillsCtx

  return tool({
    description:
      TOOL_DESCRIPTIONS.skills +
      (toolNames.includes('read_skill')
        ? ' Pass a skill_id to read_skill to open it.'
        : ''),
    inputSchema: z.object({
      search: z.string().max(64).optional(),
      cursor: z.string().max(8192).optional(),
    }),
    execute: async (input) => {
      const { catalogForTool, resolvePersonalWorkspace } =
        await import('../skills/runtime')

      const live = await ctx.runQuery(
        internal.toolkits._skillContext,
        execution,
      )

      const current = await resolvePersonalWorkspace(live.agent, live.workspace)
      const page = await catalogForTool(
        ctx,
        live.agent._id,
        current,
        input,
        live.sessionId,
      )
      return {
        ...page,
        entries: page.entries.map(
          ({ name, description, origin, skill_id, error }) => ({
            name,
            description,
            origin,
            skill_id,
            error,
          }),
        ),
      }
    },
  })
}

/** Reads enabled skill bundles through their origin-specific authorization. */
export async function createReadSkillTool(context: SkillsContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.read_skill,
    inputSchema: z.strictObject({
      skill_id: z.string().min(1).max(1024),
      resource: z.string().min(1).max(4096).optional(),
      offset: z.number().int().nonnegative().default(0),
      length: z.number().int().min(1).max(50_000).default(50_000),
    }),
    execute: async (input) => {
      const { readSkill } = await import('../skills/read')
      return readSkill(context.ctx, context.execution, input)
    },
  })
}
