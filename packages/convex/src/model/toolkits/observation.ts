import type { MutationCtx } from '../../_generated/server'
import { requireRole } from '../../functions'
import type { ToolkitObservationArgs } from '../../types'
import { requireExecution } from '../mcpOperationAccess'
import { availableToolkits } from './access'
import { reconcileToolkit } from './components'

/** Revokes changed linked files at a provider boundary until an explicit refresh applies the updated snapshot. */
export async function observe(ctx: MutationCtx, args: ToolkitObservationArgs) {
  const stream = await requireExecution(ctx, args)
  const invoker = await ctx.db.get(stream.invokedBy)
  requireRole(invoker?.role, 'admin')

  const rows = await availableToolkits(ctx, stream.agentId, stream.sessionId)
  const row = rows.find((row) => row._id === args.toolkitId)

  if (!row || row.revision !== args.acceptedRevision) return
  if (args.observedRevision === row.revision) return

  const changed = args.observedRevision !== undefined

  await ctx.db.patch(row._id, {
    status: changed ? 'changed' : 'missing',
    diagnostic: changed
      ? 'Manifest changed. Refresh to apply the updated configuration.'
      : args.diagnostic?.slice(0, 1000),
  })
  await reconcileToolkit(ctx, row._id)
}
