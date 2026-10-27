/// <reference types="bun-types" />
import {
  EMPTY_AGENT_FORM,
  formValuesToPatch,
} from '@/components/chat/entities/agent/agent-form'
import type { ToolMetadata } from '@/lib/chat'
import {
  TOOL_CAPABILITIES,
  normalizeToolSelection,
  toggleToolSelection,
} from '@sb/core/tool-capabilities'
import { expect, test } from 'bun:test'

const TOOLS: ToolMetadata[] = [
  { name: 'web_fetch', category: 'general' },
  { name: 'read_file', category: 'coding' },
  { name: 'shell', category: 'coding' },
]

test('normalization keeps unset selections off and preserves explicit choices', () => {
  expect(normalizeToolSelection()).toEqual([])
  expect(normalizeToolSelection([])).toEqual([])
  expect(
    normalizeToolSelection(['shell', 'shell', 'web_fetch', 'external_lookup']),
  ).toEqual(['shell', 'web_fetch', 'external_lookup'])
})

test('selection toggles affect only their targets and order available choices predictably', () => {
  expect(toggleToolSelection([], ['shell', 'web_fetch'], TOOLS)).toEqual([
    'web_fetch',
    'shell',
  ])
  expect(toggleToolSelection(['shell'], ['web_fetch'], TOOLS)).toEqual([
    'web_fetch',
    'shell',
  ])
  expect(toggleToolSelection(['web_fetch', 'shell'], ['shell'], TOOLS)).toEqual(
    ['web_fetch'],
  )
})

test('saving settings drops retired member keys without expanding permissions', async () => {
  const patch = await formValuesToPatch('agent' as never, {
    ...EMPTY_AGENT_FORM,
    tools: [
      'write_file',
      'edit_file',
      'read_skill',
      'shell_output',
      'plan',
      'todo',
      'shell',
      'external_work',
    ],
  })
  expect(patch.tools).toEqual(['plan', 'todo', 'shell', 'external_work'])
})

test('built-in changes preserve unavailable external selections and clear hidden built-in flags', () => {
  const builtins = TOOL_CAPABILITIES.map((row) => row.name)
  const external = ['mcp_server:offline', 'offline_lookup']
  const off = toggleToolSelection([...builtins, ...external], builtins, TOOLS)
  expect(off).toEqual(external)
  expect(toggleToolSelection(off, ['skills'], TOOLS)).toEqual([
    ...external,
    'skills',
  ])
  expect(
    toggleToolSelection([...external, 'skills'], ['skills'], TOOLS),
  ).toEqual(external)
})
