import {
  type MigrationFunctionReference,
  Migrations,
} from '@convex-dev/migrations'

import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { internalMutation } from './_generated/server'

export const migrations = new Migrations<DataModel>(components.migrations)

export const run = migrations.runner()

/**
 * Migrations an install must apply before this release can read its database,
 * in the order they have to run. Entries are only removed once no supported
 * release predates them.
 */
const releaseMigrations: MigrationFunctionReference[] = []

/**
 * Post-deploy step. Does nothing when the release ships no migration, skips
 * anything an earlier run already finished, and resumes a partial one.
 */
export const _applyRelease = internalMutation({
  args: {},
  handler: async (ctx) => {
    await migrations.runSerially(ctx, releaseMigrations)
  },
})
