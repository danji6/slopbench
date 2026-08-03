/// <reference types="bun-types" />
import { type LimitKey, limitError } from '@sb/core/limit-errors'
import {
  MAX_ENVIRONMENT_BYTES,
  MAX_PLAN_CONTENT_CHARS,
  MAX_SCOPE_PROMPTS,
} from '@sb/core/limits'
import { describe, expect, test } from 'bun:test'

const KEYS: LimitKey[] = [
  'prompts',
  'promptContent',
  'promptName',
  'reminders',
  'reminderContent',
  'reminderName',
  'mcpServers',
  'providers',
  'providerModels',
  'webSearchInstances',
  'environmentKeys',
  'environmentBytes',
  'todos',
  'todoContent',
  'planContent',
  'customCss',
  'messagePart',
  'messageContent',
]

describe('limit errors', () => {
  test('every cap reads the same way', () => {
    for (const key of KEYS) {
      expect(limitError(key)).toMatch(/^.+ limit exceeded \(max: \d+/)
    }
  })

  test('a countable cap names no unit', () => {
    expect(limitError('prompts')).toBe(
      `Prompts limit exceeded (max: ${MAX_SCOPE_PROMPTS})`,
    )
  })

  test('a measured cap names its unit', () => {
    expect(limitError('environmentBytes')).toBe(
      `Session variables size limit exceeded (max: ${MAX_ENVIRONMENT_BYTES} bytes)`,
    )
  })

  test('a model-facing cap keeps its hint', () => {
    expect(limitError('planContent')).toBe(
      `Plan content limit exceeded (max: ${MAX_PLAN_CONTENT_CHARS} characters). Shorten it.`,
    )
  })
})
