/// <reference types="bun-types" />
import {
  resolveRecentModelBinding,
  resolveSessionModelBinding,
  resolveStepCount,
} from '@sb/convex/migrations'
import {
  SCHEMA_MIGRATIONS,
  SCHEMA_MIGRATION_VERSION,
} from '@sb/core/migration-version'
import { describe, expect, test } from 'bun:test'

test('schema migration version follows the append-only manifest', () => {
  expect(SCHEMA_MIGRATION_VERSION).toBe(SCHEMA_MIGRATIONS.length)
})

describe('resolveStepCount', () => {
  test('keeps an initialized provider-step clock', () => {
    expect(resolveStepCount({ stepCount: 7, turnCount: 19 })).toBe(7)
  })

  test('copies the legacy turn clock when needed', () => {
    expect(resolveStepCount({ turnCount: 19 })).toBe(19)
  })

  test('initializes documents without either clock', () => {
    expect(resolveStepCount({})).toBe(0)
  })
})

describe('model binding migrations', () => {
  test('preserves an existing session selection', () => {
    expect(
      resolveSessionModelBinding(
        { model: { id: 'session-model' }, reasoningEffort: 'high' },
        { modelId: 'agent-model', reasoningEffort: 'low' },
      ),
    ).toEqual({ model: { id: 'session-model' }, reasoningEffort: 'high' })
  })

  test('copies missing values from the legacy active agent', () => {
    expect(
      resolveSessionModelBinding(
        {},
        { modelId: 'agent-model', reasoningEffort: 'medium' },
      ),
    ).toEqual({
      model: { id: 'agent-model' },
      reasoningEffort: 'medium',
    })
  })

  test('fills reasoning without replacing the session model', () => {
    expect(
      resolveSessionModelBinding(
        { model: { id: 'session-model' } },
        { modelId: 'agent-model', reasoningEffort: 'auto' },
      ),
    ).toEqual({
      model: { id: 'session-model' },
      reasoningEffort: 'auto',
    })
  })

  test('leaves sessions without a legacy agent unbound', () => {
    expect(resolveSessionModelBinding({}, null)).toEqual({
      model: undefined,
      reasoningEffort: undefined,
    })
  })

  test('copies recent defaults from the selected legacy agent', () => {
    expect(
      resolveRecentModelBinding(
        {},
        { modelId: 'agent-model', reasoningEffort: 'low' },
      ),
    ).toEqual({
      recentModel: 'agent-model',
      recentReasoning: 'low',
    })
  })

  test('preserves existing recent defaults and is idempotent', () => {
    const current = { recentModel: 'recent-model', recentReasoning: 'high' }
    const once = resolveRecentModelBinding(current, {
      modelId: 'agent-model',
      reasoningEffort: 'low',
    })

    expect(resolveRecentModelBinding(once, null)).toEqual(current)
  })
})
