import {
  type MigrationFunctionReference,
  Migrations,
  runToCompletion,
} from '@convex-dev/migrations'
import {
  SCHEMA_MIGRATIONS,
  SCHEMA_MIGRATION_VERSION,
  type SchemaMigrationName,
} from '@sb/core/migration-version'
import { getFunctionName } from 'convex/server'
import { v } from 'convex/values'

import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'

export const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
})

export const run = migrations.runner()

/**
 * Migrations an install must apply before this release can read its database,
 * in the order they have to run.
 *
 * Keep the shared manifest append-only and add its generated reference here.
 */
const releaseMigrationByName: Record<
  SchemaMigrationName,
  MigrationFunctionReference
> = {}
const releaseMigrations = SCHEMA_MIGRATIONS.map(
  (name) => releaseMigrationByName[name],
)

/** Stable pre-deploy endpoint used by launchers from future releases. */
export const _getReleaseState = internalQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query('releaseState')
      .withIndex('by_key', (q) => q.eq('key', 'schema'))
      .unique(),
})

export const _beginRelease = internalMutation({
  args: { targetVersion: v.number() },
  handler: async (ctx, { targetVersion }) => {
    const state = await ctx.db
      .query('releaseState')
      .withIndex('by_key', (q) => q.eq('key', 'schema'))
      .unique()
    const value = {
      key: 'schema' as const,
      phase: 'migrating' as const,
      targetVersion,
      updatedAt: Date.now(),
      version: state?.version ?? 0,
    }

    if (state) await ctx.db.replace(state._id, value)
    else await ctx.db.insert('releaseState', value)
  },
})

export const _markReleaseComplete = internalMutation({
  args: { targetVersion: v.number() },
  handler: async (ctx, { targetVersion }) => {
    const state = await ctx.db
      .query('releaseState')
      .withIndex('by_key', (q) => q.eq('key', 'schema'))
      .unique()
    if (!state || state.targetVersion !== targetVersion) {
      throw new Error('Schema migration state does not match this release')
    }

    await ctx.db.patch(state._id, {
      phase: 'complete',
      updatedAt: Date.now(),
      version: targetVersion,
    })
  },
})

/**
 * Post-deploy step. Does nothing when the release ships no migration, skips
 * anything an earlier run already finished, and resumes a partial one.
 */
export const _applyRelease = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.migrations._beginRelease, {
      targetVersion: SCHEMA_MIGRATION_VERSION,
    })
    const statuses = await migrations.getStatus(ctx, {
      migrations: releaseMigrations,
    })
    const completed = new Set(
      statuses.filter((status) => status.isDone).map((status) => status.name),
    )
    let applied = 0

    for (const migration of releaseMigrations) {
      if (completed.has(getFunctionName(migration))) continue
      await runToCompletion(ctx, components.migrations, migration)
      applied += 1
    }

    return applied === 0
      ? 'No pending migrations.'
      : `Applied ${applied} migration${applied === 1 ? '' : 's'}.`
  },
})

/** Records completion only after the launcher has restored strict validation. */
export const _completeRelease = internalAction({
  args: {},
  handler: async (ctx) => {
    const statuses = await migrations.getStatus(ctx, {
      migrations: releaseMigrations,
    })
    const incomplete = statuses.filter((status) => !status.isDone)
    if (incomplete.length > 0) {
      throw new Error(
        `Cannot complete release with ${incomplete.length} pending migrations`,
      )
    }

    await ctx.runMutation(internal.migrations._markReleaseComplete, {
      targetVersion: SCHEMA_MIGRATION_VERSION,
    })
  },
})
