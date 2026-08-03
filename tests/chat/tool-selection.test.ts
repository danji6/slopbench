/// <reference types="bun-types" />
import {
  getEnabledToolNames,
  toToolSelection,
} from '@/components/chat/entities/agent/agent-form'
import type { ToolMetadata } from '@/lib/chat'
import { describe, expect, test } from 'bun:test'

const TOOLS: ToolMetadata[] = [
  { name: 'web_fetch', category: 'general' },
  { name: 'read_file', category: 'coding' },
  { name: 'shell', category: 'coding' },
]

describe('getEnabledToolNames', () => {
  test('empty array selects no tools', () => {
    expect(getEnabledToolNames([], TOOLS)).toEqual([])
  })

  // Legacy non-array selections are normalized away by the `typedFields`
  // migration, so only the unset case reaches here now
  test('an unset selection selects no tools', () => {
    expect(getEnabledToolNames(undefined, TOOLS)).toEqual([])
  })

  test('selects exactly the available tools, in available order', () => {
    expect(
      getEnabledToolNames(['shell', 'web_fetch', 'unknown'], TOOLS),
    ).toEqual(['web_fetch', 'shell'])
  })
})

describe('toToolSelection', () => {
  test('no tools normalizes to an empty array (never undefined)', () => {
    expect(toToolSelection([], TOOLS)).toEqual([])
  })

  test('orders the selection by the available list', () => {
    expect(toToolSelection(['shell', 'web_fetch'], TOOLS)).toEqual([
      'web_fetch',
      'shell',
    ])
  })

  test('round-trips through getEnabledToolNames', () => {
    for (const selection of [[], ['shell'], ['web_fetch', 'read_file']]) {
      const names = getEnabledToolNames(selection, TOOLS)
      expect(getEnabledToolNames(toToolSelection(names, TOOLS), TOOLS)).toEqual(
        names,
      )
    }
  })
})
