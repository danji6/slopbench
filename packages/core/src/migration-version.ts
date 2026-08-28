/** The (append-only) order for schema/data migrations shipped at startup. */
export const SCHEMA_MIGRATIONS = [
  'finalizeReminderStepCount',
  'finalizeTodoStepCount',
  'bindModelsToSessions',
  'initializeRecentModelSelection',
  'removeAgentModelSelection',
] as const

export type SchemaMigrationName = (typeof SCHEMA_MIGRATIONS)[number]

/** The version advances automatically with the migration manifest. */
export const SCHEMA_MIGRATION_VERSION = SCHEMA_MIGRATIONS.length

export type SchemaMigrationState = {
  key: 'schema'
  phase: 'migrating' | 'complete'
  targetVersion: number
  updatedAt: number
  version: number
}
