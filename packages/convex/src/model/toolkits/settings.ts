import { isSkillName, updateDisabledSkills } from '@cv/core/skills/names'

import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { ToolkitMissingArgs, ToolkitSettingsArgs } from '../../types'
import { removeServer } from '../mcp'
import { ownedToolkit, toolkitActor } from './access'
import { assertConfigurationCapacity } from './capacity'
import { componentRows, reconcileToolkit } from './components'

export async function missing(ctx: MutationCtx, args: ToolkitMissingArgs) {
  const actor = await toolkitActor(ctx, args.subject)
  const row = await ctx.db.get(args.toolkitId)
  if (!row) return
  if (row.ownerId !== actor._id) error('Toolkit not found', 404)
  if (row.revision !== args.acceptedRevision) return
  await ctx.db.patch(row._id, {
    status: 'missing',
    diagnostic: args.diagnostic.slice(0, 1000),
  })
  await reconcileToolkit(ctx, row._id)
}

export async function settings(
  ctx: AuthMutationCtx,
  args: ToolkitSettingsArgs,
) {
  const row = await ownedToolkit(ctx, args.toolkitId)
  const { toolkitId, skill, ...patch } = args

  if (skill) {
    if (!isSkillName(skill.name)) error('Invalid skill component name', 400)
    if (patch.disabledSkills)
      error('Cannot combine skill and batch selection updates', 400)
    patch.disabledSkills = updateDisabledSkills(
      row.disabledSkills,
      skill.name,
      skill.enabled,
    )
  }
  if ((patch.disabledSkills?.length ?? 0) > 5000) {
    error('Too many skill component settings', 400)
  }

  const invalidSkillNames = patch.disabledSkills?.some((name) => !isSkillName(name)) // prettier-ignore
  if (invalidSkillNames) error('Invalid skill component name', 400)

  await ctx.db.patch(toolkitId, patch)
  if (patch.disabledSkills) await assertConfigurationCapacity(ctx, row.ownerId)
  await reconcileToolkit(ctx, row._id)
}

export async function remove(ctx: AuthMutationCtx, id: Id<'toolkits'>) {
  const toolkit = await ownedToolkit(ctx, id)
  const agents = await ctx.db
    .query('agents')
    .withIndex('by_ownerId_name', (q) => q.eq('ownerId', toolkit.ownerId))
    .collect()

  for (const agent of agents) {
    if (agent.toolkitIds?.includes(id))
      await ctx.db.patch(agent._id, {
        toolkitIds: agent.toolkitIds.filter((selected) => selected !== id),
      })
  }
  for (const server of await componentRows(ctx, id)) {
    await removeServer(ctx, server)
  }

  await ctx.db.delete(id)
}
