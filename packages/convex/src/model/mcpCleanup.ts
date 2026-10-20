import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { McpCleanupArgs } from '../types'

export function get(ctx: QueryCtx, { cleanupId }: McpCleanupArgs) {
  return ctx.db.get(cleanupId)
}

export async function done(ctx: MutationCtx, { cleanupId }: McpCleanupArgs) {
  if (await ctx.db.get(cleanupId)) {
    await ctx.db.delete(cleanupId)
  }
}

export function pending(ctx: QueryCtx) {
  return ctx.db.query('mcpCleanups').take(64)
}
