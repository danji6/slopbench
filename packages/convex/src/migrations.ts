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
import type { ModelEntry } from './types'

export const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
})

export const run = migrations.runner()

type LegacyStepClock = {
  stepCount?: number
  turnCount?: number
}

/** Resolves the final clock value while old documents are still readable. */
export function resolveStepCount(clock: LegacyStepClock) {
  return clock.stepCount ?? clock.turnCount ?? 0
}

type LegacyAgentModel = {
  modelId?: string
  reasoningEffort?: string
}

type SessionModelBinding = {
  model?: ModelEntry
  reasoningEffort?: string
}

type RecentModelBinding = {
  recentModel?: string
  recentReasoning?: string
}

/** Preserves session-owned values before falling back to its legacy agent. */
export function resolveSessionModelBinding(
  session: SessionModelBinding,
  agent: LegacyAgentModel | null,
): SessionModelBinding {
  return {
    model:
      session.model ?? (agent?.modelId ? { id: agent.modelId } : undefined),
    reasoningEffort:
      session.reasoningEffort ?? agent?.reasoningEffort ?? undefined,
  }
}

/** Seeds future session defaults only when no model was previously selected. */
export function resolveRecentModelBinding(
  settings: RecentModelBinding,
  agent: LegacyAgentModel | null,
): RecentModelBinding {
  if (settings.recentModel !== undefined) return settings
  if (!agent?.modelId) return settings

  return {
    recentModel: agent.modelId,
    recentReasoning: agent.reasoningEffort,
  }
}

/** Ensures hot session state has a step clock and removes the old session clock. */
export const finalizeReminderStepCount = migrations.define({
  table: 'sessions',
  migrateOne: async (ctx, session) => {
    const legacySession = session as typeof session & LegacyStepClock
    const state = await ctx.db
      .query('sessionState')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
      .unique()
    const legacyState = state as (typeof state & LegacyStepClock) | null

    if (state) {
      if (legacyState?.stepCount === undefined) {
        await ctx.db.patch(state._id, {
          stepCount: resolveStepCount(legacySession),
        })
      }
    } else if (legacySession.turnCount !== undefined) {
      await ctx.db.insert('sessionState', {
        sessionId: session._id,
        stepCount: legacySession.turnCount,
        updatedAt: Date.now(),
      })
    }

    if (legacySession.turnCount !== undefined) {
      await ctx.db.patch(session._id, { turnCount: undefined } as never)
    }
  },
})

/** Preserves the todo nudge baseline and removes its old turn clock. */
export const finalizeTodoStepCount = migrations.define({
  table: 'todos',
  migrateOne: async (_ctx, todo) => {
    const legacyTodo = todo as typeof todo & LegacyStepClock
    return {
      stepCount: resolveStepCount(legacyTodo),
      turnCount: undefined,
    } as never
  },
})

/** Copies the active agent's legacy model settings onto each session. */
export const bindModelsToSessions = migrations.define({
  table: 'sessions',
  migrateOne: async (ctx, session) => {
    const agent = session.activeAgentId
      ? await ctx.db.get(session.activeAgentId)
      : null
    return resolveSessionModelBinding(
      session,
      agent as (typeof agent & LegacyAgentModel) | null,
    )
  },
})

/** Preserves the selected agent's model as the new session default. */
export const initializeRecentModelSelection = migrations.define({
  table: 'settings',
  migrateOne: async (ctx, settings) => {
    const agent = settings.recentAgentId
      ? await ctx.db.get(settings.recentAgentId)
      : null
    return resolveRecentModelBinding(
      settings,
      agent as (typeof agent & LegacyAgentModel) | null,
    )
  },
})

/** Removes model selection after every dependent document has been seeded. */
export const removeAgentModelSelection = migrations.define({
  table: 'agents',
  migrateOne: async () =>
    ({ modelId: undefined, reasoningEffort: undefined }) as never,
})

/**
 * Migrations an install must apply before this release can read its database,
 * in the order they have to run.
 *
 * Keep the shared manifest append-only and add its generated reference here.
 * Cast fields that don't exist anymore.
 */
const releaseMigrationByName: Record<
  SchemaMigrationName,
  MigrationFunctionReference
> = {
  bindModelsToSessions: internal.migrations.bindModelsToSessions,
  finalizeReminderStepCount: internal.migrations.finalizeReminderStepCount,
  finalizeTodoStepCount: internal.migrations.finalizeTodoStepCount,
  initializeRecentModelSelection:
    internal.migrations.initializeRecentModelSelection,
  removeAgentModelSelection: internal.migrations.removeAgentModelSelection,
}
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
