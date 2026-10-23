import type { AuthMutationCtx } from '../../functions'
import type { IntegrationSelectionArgs } from '../../types'
import { ownedIntegration, requireSelectionAccess } from './access'
import { reconcileIntegration } from './components'

export async function select(
  ctx: AuthMutationCtx,
  args: IntegrationSelectionArgs,
) {
  await ownedIntegration(ctx, args.integrationId)
  const agent = await requireSelectionAccess(ctx, args.agentId)
  const ids = new Set(agent.integrationIds ?? [])
  if (args.enabled) ids.add(args.integrationId)
  else ids.delete(args.integrationId)
  await ctx.db.patch(agent._id, { integrationIds: [...ids] })
  await reconcileIntegration(ctx, args.integrationId)
}
