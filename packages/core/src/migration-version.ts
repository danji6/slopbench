/** Pre-release baseline. */
export const SCHEMA_BASELINE_VERSION = 5

/** The append-only order for migrations shipped after the public baseline. */
export const SCHEMA_MIGRATIONS = [] as const

export type SchemaMigrationName = (typeof SCHEMA_MIGRATIONS)[number]

/** The version advances automatically with the public migration manifest. */
export const SCHEMA_MIGRATION_VERSION =
  SCHEMA_BASELINE_VERSION + SCHEMA_MIGRATIONS.length

export type SchemaMigrationState = {
  key: 'schema'
  phase: 'migrating' | 'complete'
  targetVersion: number
  updatedAt: number
  version: number
}
