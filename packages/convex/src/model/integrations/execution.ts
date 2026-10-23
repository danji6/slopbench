import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { requireRole } from '../../functions'
import type { StreamExecutionArgs } from '../../types'
import { requireExecution } from '../mcpOperationAccess'
import { hasInvocationAccess } from '../mcpRuntime'
import { availableIntegrations } from './access'

export async function executionIntegrations(
  ctx: QueryCtx,
  args: StreamExecutionArgs,
) {
  const stream = await requireExecution(ctx, args)
  const invoker = await ctx.db.get(stream.invokedBy)
  requireRole(invoker?.role, 'admin')
  if (!(await hasInvocationAccess(ctx, stream.sessionId, stream.invokedBy)))
    error('Integration access revoked', 403)
  return availableIntegrations(ctx, stream.agentId, stream.sessionId)
}
