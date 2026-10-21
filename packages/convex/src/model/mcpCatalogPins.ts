import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { error } from '../errors'
import type { ToolManifest } from './tool/manifest'

/** Pins immutable definitions while a session's frozen tool manifest references them. */
export async function pinManifest(
  ctx: MutationCtx,
  cacheId: Id<'sessionCache'>,
  manifest: ToolManifest,
) {
  const cache = await ctx.db.get(cacheId)
  const agent = cache ? await ctx.db.get(cache.agentId) : null
  if (!agent) error('MCP manifest owner unavailable', 409)

  const catalogs = new Set<Id<'mcpCatalogs'>>()

  for (const entry of manifest.mcp ?? []) {
    if (!entry.definitionRef) continue
    const tool = await ctx.db
      .query('mcpCatalogTools')
      .withIndex('by_definitionRef', (q) =>
        q.eq('definitionRef', entry.definitionRef as Id<'_storage'>),
      )
      .unique()

    const catalog = tool ? await ctx.db.get(tool.catalogId) : null
    if (!catalog || catalog.ownerId !== agent.ownerId)
      error('MCP definition does not belong to this manifest owner', 403)

    catalogs.add(catalog._id)
  }

  const previous = await ctx.db
    .query('mcpCatalogPins')
    .withIndex('by_cacheId', (q) => q.eq('cacheId', cacheId))
    .collect()

  for (const pin of previous) {
    if (catalogs.delete(pin.catalogId)) continue
    await ctx.db.delete(pin._id)
    await ctx.scheduler.runAfter(0, internal.actions.mcpCatalogs._expire, {
      catalogId: pin.catalogId,
    })
  }
  for (const catalogId of catalogs) {
    await ctx.db.insert('mcpCatalogPins', { catalogId, cacheId })
  }
}

/** Drops dead pins and protects definitions still referenced by a live cache row. */
export async function hasPins(ctx: MutationCtx, catalog: Doc<'mcpCatalogs'>) {
  const pins = await ctx.db
    .query('mcpCatalogPins')
    .withIndex('by_catalogId', (q) => q.eq('catalogId', catalog._id))
    .take(64)
  let live = false

  for (const pin of pins) {
    if (await ctx.db.get(pin.cacheId)) live = true
    else await ctx.db.delete(pin._id)
  }

  return live || pins.length === 64
}

export async function releasePins(
  ctx: MutationCtx,
  cacheId: Id<'sessionCache'>,
) {
  const pins = await ctx.db
    .query('mcpCatalogPins')
    .withIndex('by_cacheId', (q) => q.eq('cacheId', cacheId))
    .collect()
  for (const pin of pins) {
    await ctx.db.delete(pin._id)
    await ctx.scheduler.runAfter(0, internal.actions.mcpCatalogs._expire, {
      catalogId: pin.catalogId,
    })
  }
}
