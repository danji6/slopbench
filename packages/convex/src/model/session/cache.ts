import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import type { SaveSessionCacheArgs } from '../../types'

/**
 * Cache of everything that shapes the provider request prefix:
 * - Row absence means the entry needs to be (re)computed.
 * - `getVar()` inside a frozen prompt reads the environment as of capture time.
 * - `tools` is just the shape, their behavior is rebuilt live every step.
 * - Invalidated only by `/eval` (see model/chat/controls.ts) or session removal.
 */
export async function getBySessionAgent(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  agentId: Id<'agents'>,
) {
  return ctx.db
    .query('sessionCache')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', sessionId).eq('agentId', agentId),
    )
    .unique()
}

/** Upsert. Patches only the keys present. */
export async function _save(ctx: MutationCtx, args: SaveSessionCacheArgs) {
  const existing = await getBySessionAgent(ctx, args.sessionId, args.agentId)
  const capturedAt = Date.now()

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...(args.items && { items: args.items }),
      ...(args.tools && { tools: args.tools }),
      capturedAt,
    })
    return existing._id
  }

  return ctx.db.insert('sessionCache', {
    sessionId: args.sessionId,
    agentId: args.agentId,
    items: args.items ?? [],
    tools: args.tools,
    capturedAt,
  })
}

/** Drops every cache row of the session, scheduling a full re-evaluation. */
export async function removeForSession(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const rows = await ctx.db
    .query('sessionCache')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()
  for (const row of rows) await ctx.db.delete(row._id)
}
