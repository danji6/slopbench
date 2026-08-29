/// <reference types="bun-types" />
import {
  SCHEMA_BASELINE_VERSION,
  SCHEMA_MIGRATIONS,
  SCHEMA_MIGRATION_VERSION,
} from '@sb/core/migration-version'
import { expect, test } from 'bun:test'

test('schema version advances from the public baseline', () => {
  expect(SCHEMA_BASELINE_VERSION).toBe(5)
  expect(SCHEMA_MIGRATIONS).toEqual([])
  expect(SCHEMA_MIGRATION_VERSION).toBe(
    SCHEMA_BASELINE_VERSION + SCHEMA_MIGRATIONS.length,
  )
})
