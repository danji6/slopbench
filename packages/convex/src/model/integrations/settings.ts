import { isSkillName, updateDisabledSkills } from '@sb/core/skills/names'

import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type {
  IntegrationMissingArgs,
  IntegrationSettingsArgs,
} from '../../types'
import { removeServer } from '../mcp'
import { integrationActor, ownedIntegration } from './access'
import { assertConfigurationCapacity } from './capacity'
import { componentRows, reconcileIntegration } from './components'

export async function missing(ctx: MutationCtx, args: IntegrationMissingArgs) {
  const actor = await integrationActor(ctx, args.subject)
  const row = await ctx.db.get(args.integrationId)
  if (!row) return
  if (row.ownerId !== actor._id) error('Integration not found', 404)
  if (row.revision !== args.acceptedRevision) return
  await ctx.db.patch(row._id, {
    status: 'missing',
    diagnostic: args.diagnostic.slice(0, 1000),
  })
  await reconcileIntegration(ctx, row._id)
}

export async function settings(
  ctx: AuthMutationCtx,
  args: IntegrationSettingsArgs,
) {
  const row = await ownedIntegration(ctx, args.integrationId)
  const { integrationId, skill, ...patch } = args

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

  await ctx.db.patch(integrationId, patch)
  if (patch.disabledSkills) await assertConfigurationCapacity(ctx, row.ownerId)
  await reconcileIntegration(ctx, row._id)
}

export async function remove(ctx: AuthMutationCtx, id: Id<'integrations'>) {
  const integration = await ownedIntegration(ctx, id)
  const agents = await ctx.db
    .query('agents')
    .withIndex('by_ownerId_name', (q) => q.eq('ownerId', integration.ownerId))
    .collect()

  for (const agent of agents) {
    if (agent.integrationIds?.includes(id))
      await ctx.db.patch(agent._id, {
        integrationIds: agent.integrationIds.filter(
          (selected) => selected !== id,
        ),
      })
  }
  for (const server of await componentRows(ctx, id)) {
    await removeServer(ctx, server)
  }

  await ctx.db.delete(id)
}
