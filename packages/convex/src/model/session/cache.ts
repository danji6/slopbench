import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import type { SaveSessionCacheArgs } from '../../types'
import { getSessionWithWorkspace, workspaceKey } from './folderContext'

/**
 * Cache of everything that shapes the provider request prefix:
 * - Row absence means the entry needs to be (re)computed.
 * - `getVar()` inside a frozen prompt reads the environment as of capture time.
 * - `tools` is just the shape, their behavior is rebuilt live every step.
 * - Invalidated by `/eval`, folder source changes, or session removal.
 */
export async function getBySessionAgent(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  agentId: Id<'agents'>,
) {
  const row = await findCache(ctx, sessionId, agentId)
  const session = await getSessionWithWorkspace(ctx, sessionId)
  return row?.workspaceRevision === workspaceKey(session?.workspace)
    ? row
    : null
}

async function findCache(
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
  const existing = await findCache(ctx, args.sessionId, args.agentId)
  const workspaceRevision = workspaceKey(
    (await getSessionWithWorkspace(ctx, args.sessionId))?.workspace,
  )
  const capturedAt = Date.now()

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...(existing.workspaceRevision !== workspaceRevision && {
        items: [],
        tools: undefined,
      }),
      ...(args.items && { items: args.items }),
      ...(args.tools && { tools: args.tools }),
      capturedAt,
      workspaceRevision,
    })
    return existing._id
  }

  return ctx.db.insert('sessionCache', {
    sessionId: args.sessionId,
    agentId: args.agentId,
    items: args.items ?? [],
    tools: args.tools,
    capturedAt,
    workspaceRevision,
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
