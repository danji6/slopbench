'use node'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import type { IntegrationSkillReadArgs } from '../../types'
import { integrationRequest } from './transport'

export async function readSkill(
  ctx: ActionCtx,
  args: IntegrationSkillReadArgs,
) {
  const access = await ctx.runQuery(internal.integrations._skillAccess, args)
  const result = await integrationRequest('read', access)
  // Revocation while reading cannot publish newly inaccessible instructions
  await ctx.runQuery(internal.integrations._skillAccess, args)
  return result
}
