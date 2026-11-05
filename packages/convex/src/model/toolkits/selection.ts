import type { AuthMutationCtx } from '../../functions'
import type { ToolkitSelectionArgs } from '../../types'
import { ownedToolkit, requireSelectionAccess } from './access'
import { reconcileToolkit } from './components'

export async function select(ctx: AuthMutationCtx, args: ToolkitSelectionArgs) {
  await ownedToolkit(ctx, args.toolkitId)
  const agent = await requireSelectionAccess(ctx, args.agentId)
  const ids = new Set(agent.toolkitIds ?? [])
  if (args.enabled) ids.add(args.toolkitId)
  else ids.delete(args.toolkitId)
  await ctx.db.patch(agent._id, { toolkitIds: [...ids] })
  await reconcileToolkit(ctx, args.toolkitId)
}
