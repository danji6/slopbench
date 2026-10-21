import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { allowedTarget } from './mcpOperationAccess'
import { cancelOne } from './mcpOperations'

/** Cancels affected operations in the same transaction that narrows target availability. */
export async function revokeRestrictedTargets(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  serverKey: string,
) {
  const runtimes = await ctx.db
    .query('mcpRuntimes')
    .withIndex('by_ownerId_serverKey', (q) =>
      q.eq('ownerId', ownerId).eq('serverKey', serverKey),
    )
    .collect()
  for (const runtime of runtimes) {
    const operations = await ctx.db
      .query('mcpOperations')
      .withIndex('by_runtimeId_state', (q) =>
        q.eq('runtimeId', runtime._id).eq('state', 'running'),
      )
      .take(64)
    for (const operation of operations) {
      if ((await allowedTarget(ctx, operation)) === 'allowed') continue
      await cancelOne(
        ctx,
        operation,
        'MCP target availability changed; execution revoked',
      )
    }
  }
}
