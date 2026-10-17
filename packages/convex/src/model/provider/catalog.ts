import { discoveredFields } from '@sb/core/discovered-model'
import { DISCOVERY_STALE_MS } from '@sb/core/model-discovery'
import type { DiscoveredModel } from '@sb/core/model-discovery'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import type { AuthQueryCtx } from '../../functions'
import type { DetailTargetsArgs, DiscoveryRun } from '../../types'
import { requireOwned } from '../providers'

export async function catalog(
  ctx: AuthQueryCtx,
  { providerId }: { providerId: Id<'modelProviders'> },
) {
  const provider = await requireOwned(ctx, providerId)
  const rows = provider.discoveryGeneration
    ? await ctx.db
        .query('modelCatalog')
        .withIndex('by_connection_generation_order', (q) =>
          q
            .eq('connectionId', providerId)
            .eq('generation', provider.discoveryGeneration!),
        )
        .collect()
    : []
  return {
    models: rows.map((row) => row.model),
    generation: provider.discoveryGeneration,
    revision: provider.configRevision ?? 0,
    refreshedAt: provider.discoveredAt,
    error: provider.discoveryError,
    refreshing:
      !!provider.discoveryStartedAt &&
      Date.now() - provider.discoveryStartedAt < 120_000,
  }
}

export async function begin(
  ctx: MutationCtx,
  args: DiscoveryRun & { force: boolean },
) {
  const provider = await requireRun(ctx, args)

  if (!provider) {
    return false
  }
  if (
    provider.discoveryStartedAt &&
    Date.now() - provider.discoveryStartedAt < 120_000
  ) {
    return false
  }
  if (
    provider.discoveryRateLimitedUntil &&
    provider.discoveryRateLimitedUntil > Date.now()
  ) {
    return false
  }
  if (
    !args.force &&
    provider.discoveryRetryAt &&
    provider.discoveryRetryAt > Date.now()
  ) {
    return false
  }
  if (!args.force && provider.discoveryBlocked) {
    return false
  }

  const cooldown = args.force ? 10_000 : 60_000
  if (
    provider.discoveryAttemptedAt &&
    Date.now() - provider.discoveryAttemptedAt < cooldown
  ) {
    return false
  }
  if (
    !args.force &&
    provider.discoveredAt &&
    Date.now() - provider.discoveredAt < DISCOVERY_STALE_MS
  ) {
    return false
  }

  await ctx.db.patch(args.providerId, {
    discoveryStartedAt: Date.now(),
    discoveryAttemptedAt: Date.now(),
    discoveryError: undefined,
    discoveryAttempt: args.generation,
  })

  const { force: _, ...run } = args
  await ctx.scheduler.runAfter(
    120_000,
    internal.providers._expireDiscovery,
    run,
  )

  return true
}

export async function stage(
  ctx: MutationCtx,
  args: DiscoveryRun & { models: DiscoveredModel[]; offset: number },
) {
  if (!(await requireAttempt(ctx, args))) return
  for (const [i, model] of args.models.entries()) {
    await ctx.db.insert('modelCatalog', {
      connectionId: args.providerId,
      generation: args.generation,
      order: args.offset + i,
      model,
    })
  }
}

export async function finish(
  ctx: MutationCtx,
  args: DiscoveryRun & {
    failure?: string
    retryAfter?: number
    blocked?: boolean
  },
) {
  const provider = await requireAttempt(ctx, args)
  if (!provider) return
  if (args.failure) {
    await ctx.db.patch(args.providerId, {
      discoveryStartedAt: undefined,
      discoveryAttempt: undefined,
      discoveryError: args.failure,
      discoveryFailures: (provider.discoveryFailures ?? 0) + 1,
      discoveryRetryAt: Math.max(
        args.retryAfter ?? 0,
        Date.now() +
          Math.min(
            60 * 60_000,
            60_000 * 2 ** Math.min(provider.discoveryFailures ?? 0, 6),
          ),
      ),
      discoveryBlocked: args.blocked,
      discoveryRateLimitedUntil: args.retryAfter,
    })
    return
  }

  const rows = await ctx.db
    .query('modelCatalog')
    .withIndex('by_connection_generation_order', (q) =>
      q.eq('connectionId', args.providerId).eq('generation', args.generation),
    )
    .collect()

  const previous = provider.discoveryGeneration
    ? await ctx.db
        .query('modelCatalog')
        .withIndex('by_connection_generation_order', (q) =>
          q
            .eq('connectionId', args.providerId)
            .eq('generation', provider.discoveryGeneration!),
        )
        .collect()
    : []

  for (const row of rows) {
    const cached = previous.find((old) => old.model.id === row.model.id)?.model
    if (
      cached?.detailsLoaded &&
      cached.detailKey &&
      cached.detailKey === row.model.detailKey
    ) {
      row.model = { ...cached, ...row.model, detailsLoaded: true }
      await ctx.db.patch(row._id, { model: row.model })
    }
  }

  const ids = new Set(rows.map((row) => row.model.id))
  await ctx.db.patch(args.providerId, {
    discoveryGeneration: args.generation,
    discoveryFailures: undefined,
    discoveryRateLimitedUntil: undefined,
    discoveryRetryAt: undefined,
    discoveryBlocked: undefined,
    discoveredAt: Date.now(),
    discoveryStartedAt: undefined,
    discoveryAttempt: undefined,
    discoveryError: undefined,
    models: provider.models.map((model) => {
      const discovered = rows.find((row) => row.model.id === model.id)?.model
      return {
        ...model,
        available:
          model.source === 'discovered' ? ids.has(model.id) : model.available,
        ...(discovered ? discoveredFields(discovered) : {}),
      }
    }),
  })

  return true
}

async function requireRun(ctx: MutationCtx, args: DiscoveryRun) {
  const provider = await ctx.db.get(args.providerId)
  if (!provider || provider.ownerId !== args.ownerId) return null
  return (provider.configRevision ?? 0) === args.revision ? provider : null
}

async function requireAttempt(ctx: MutationCtx, args: DiscoveryRun) {
  const provider = await requireRun(ctx, args)
  return provider?.discoveryAttempt === args.generation ? provider : null
}

/** Deletes old and interrupted catalogs in bounded batches. */
export async function cleanup(
  ctx: MutationCtx,
  { providerId }: { providerId: Id<'modelProviders'> },
) {
  const provider = await ctx.db.get(providerId)
  const rows = await ctx.db
    .query('modelCatalog')
    .withIndex('by_connection_generation_order', (q) =>
      q.eq('connectionId', providerId),
    )
    .filter((q) =>
      q.and(
        q.neq(q.field('generation'), provider?.discoveryGeneration ?? ''),
        q.neq(q.field('generation'), provider?.discoveryAttempt ?? ''),
      ),
    )
    .take(200)
  // Called only after a run finishes; never remove an active attempt
  let deleted = 0
  for (const row of rows) {
    if (
      row.generation === provider?.discoveryGeneration ||
      row.generation === provider?.discoveryAttempt
    )
      continue
    await ctx.db.delete(row._id)
    deleted++
  }
  if (deleted === 200) {
    await ctx.scheduler.runAfter(0, internal.providers._cleanupCatalog, {
      providerId,
    })
  }
  return deleted
}

/** Releases a stranded attempt so its reactive status and manual retry recover. */
export async function expire(ctx: MutationCtx, args: DiscoveryRun) {
  const provider = await requireAttempt(ctx, args)
  if (!provider) return
  await ctx.db.patch(args.providerId, {
    discoveryAttempt: undefined,
    discoveryStartedAt: undefined,
    discoveryError: 'Model refresh was interrupted. Retry discovery.',
  })
  await cleanup(ctx, { providerId: args.providerId })
}

/** Invalidates account-specific metadata without changing the settings revision. */
export async function reset(
  ctx: MutationCtx,
  { providerId }: { providerId: Id<'modelProviders'> },
) {
  const row = await ctx.db.get(providerId)
  if (!row) return
  await ctx.db.patch(providerId, {
    discoveryGeneration: undefined,
    discoveredAt: undefined,
    discoveryAttempt: undefined,
    discoveryStartedAt: undefined,
    discoveryAttemptedAt: undefined,
    discoveryRetryAt: undefined,
    discoveryBlocked: undefined,
    discoveryFailures: undefined,
    discoveryRateLimitedUntil: undefined,
    discoveryError: undefined,
    models: row.models.map((model) =>
      model.source === 'discovered' ? { ...model, available: false } : model,
    ),
  })
}

export async function enrich(
  ctx: MutationCtx,
  args: DiscoveryRun & { model: DiscoveredModel },
) {
  const provider = await requireRun(ctx, args)
  if (!provider || provider.discoveryGeneration !== args.generation) return

  const rows = await ctx.db
    .query('modelCatalog')
    .withIndex('by_connection_generation_order', (q) =>
      q.eq('connectionId', args.providerId).eq('generation', args.generation),
    )
    .collect()
  const row = rows.find((entry) => entry.model.id === args.model.id)
  if (!row || row.model.detailKey !== args.model.detailKey) return

  await ctx.db.patch(row._id, { model: args.model })
  await ctx.db.patch(args.providerId, {
    models: provider.models.map((model) =>
      model.id === args.model.id
        ? { ...model, ...discoveredFields(args.model) }
        : model,
    ),
  })

  return true
}

/** Selects metadata work only while its catalog and settings revision remain current. */
export async function detailTargets(ctx: QueryCtx, args: DetailTargetsArgs) {
  const provider = await ctx.db.get(args.providerId)
  if (!provider || provider.ownerId !== args.ownerId) {
    return []
  }
  if (
    (provider.configRevision ?? 0) !== args.revision ||
    provider.discoveryGeneration !== args.generation
  ) {
    return []
  }

  const rows = await ctx.db
    .query('modelCatalog')
    .withIndex('by_connection_generation_order', (q) =>
      q.eq('connectionId', args.providerId).eq('generation', args.generation),
    )
    .collect()

  return rows
    .filter(
      (row) => args.modelIds.includes(row.model.id) && !row.model.detailsLoaded,
    )
    .map((row) => row.model)
}
