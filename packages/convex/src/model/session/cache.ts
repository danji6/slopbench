import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import type { SaveSessionCacheArgs } from '../../types'
import { pinManifest, releasePins } from '../mcpCatalogPins'
import { getSessionWithWorkspace, workspaceKey } from './folderContext'

/**
 * Cache of everything that shapes the provider request prefix:
 * - Row absence means the entry needs to be (re)computed.
 * - `getVar()` inside a frozen prompt reads the environment as of capture time.
 * - `tools` is just the shape, their behavior is rebuilt live every step.
 * - Invalidated by `/eval`, a privilege change, or session removal.
 * - Filesystem authority and grants are resolved independently of this snapshot.
 */
export async function getBySessionAgent(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  agentId: Id<'agents'>,
  filesystemAccess = false,
) {
  const row = await findCache(ctx, sessionId, agentId)
  return row && (row.filesystemAccess ?? false) === filesystemAccess
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
  const homeId = (await ctx.db.get(args.agentId))?.homeId
  const homeRevision = homeId ? ((await ctx.db.get(homeId))?.revision ?? 0) : 0

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...(args.items && { items: args.items }),
      ...(args.tools && { tools: args.tools }),
      ...(args.historyPresentation && {
        historyPresentation: args.historyPresentation,
      }),
      capturedAt,
      homeId,
      filesystemAccess: args.filesystemAccess ?? false,
      homeRevision,
      workspaceRevision,
    })
    const changedReferences =
      args.tools &&
      [...(args.tools.mcp ?? []), ...(existing.tools?.mcp ?? [])].some(
        (entry) => entry.definitionRef,
      )
    if (changedReferences) await pinManifest(ctx, existing._id, args.tools!)
    return existing._id
  }

  const id = await ctx.db.insert('sessionCache', {
    sessionId: args.sessionId,
    agentId: args.agentId,
    items: args.items ?? [],
    tools: args.tools,
    historyPresentation: args.historyPresentation,
    capturedAt,
    homeId,
    filesystemAccess: args.filesystemAccess ?? false,
    homeRevision,
    workspaceRevision,
  })
  if (args.tools?.mcp?.some((entry) => entry.definitionRef))
    await pinManifest(ctx, id, args.tools)
  return id
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
  for (const row of rows) {
    await removeCacheRow(ctx, row)
  }
}

export async function removeCacheRow(
  ctx: MutationCtx,
  row: Doc<'sessionCache'>,
) {
  if (row.tools?.mcp?.some((entry) => entry.definitionRef))
    await releasePins(ctx, row._id)
  await ctx.db.delete(row._id)
}
