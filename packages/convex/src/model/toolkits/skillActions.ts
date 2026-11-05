'use node'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import type { ToolkitSkillReadArgs } from '../../types'
import { toolkitRequest } from './transport'

export async function readSkill(ctx: ActionCtx, args: ToolkitSkillReadArgs) {
  const access = await ctx.runQuery(internal.toolkits._skillAccess, args)
  const result = await toolkitRequest('read', access)
  // Revocation while reading cannot publish newly inaccessible instructions
  await ctx.runQuery(internal.toolkits._skillAccess, args)
  return result
}
