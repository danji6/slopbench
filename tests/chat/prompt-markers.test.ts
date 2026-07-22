/// <reference types="bun-types" />
import {
  createDefaultAgent,
  createDefaultCompactionPrompts,
  createDefaultImpersonationPrompts,
} from '@sb/convex/model/defaults'
import { ensurePromptMarkers } from '@sb/convex/model/prompt/markers'
import type { Prompt, PromptItem, PromptMarkerType } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'

const AGENT_MARKERS: PromptMarkerType[] = ['message-history', 'system-boundary']
const OPERATION_MARKERS: PromptMarkerType[] = [
  'message-history',
  'agent-prompts',
  'system-boundary',
]

function prompt(overrides: Partial<Prompt> & { id: string }): Prompt {
  return {
    name: 'Prompt',
    role: 'system',
    content: `${overrides.id} content.`,
    enabled: true,
    visible: false,
    starter: false,
    ...overrides,
  }
}

describe('ensurePromptMarkers', () => {
  test('defaults already carry every marker of their list', () => {
    const agent = createDefaultAgent().prompts as PromptItem[]

    expect(ensurePromptMarkers(agent, AGENT_MARKERS)).toEqual(agent)

    for (const defaults of [
      createDefaultCompactionPrompts(),
      createDefaultImpersonationPrompts(),
    ]) {
      expect(ensurePromptMarkers(defaults, OPERATION_MARKERS)).toEqual(defaults)
    }
  })

  test('appends a missing history marker', () => {
    const system = prompt({ id: 'system' })

    expect(ensurePromptMarkers([system], ['message-history'])).toEqual([
      system,
      { type: 'message-history' },
    ])
  })

  test('closes the system block where it already ends', () => {
    const system = prompt({ id: 'system' })
    const user = prompt({ id: 'user', role: 'user' })

    expect(ensurePromptMarkers([system, user], ['system-boundary'])).toEqual([
      system,
      { type: 'system-boundary' },
      user,
    ])
  })

  test('the system block reaches past spliced-in agent prompts', () => {
    const items: PromptItem[] = [
      { type: 'agent-prompts' },
      { type: 'message-history' },
    ]

    expect(ensurePromptMarkers(items, ['system-boundary'])).toEqual([
      { type: 'agent-prompts' },
      { type: 'system-boundary' },
      { type: 'message-history' },
    ])
  })

  test('agent prompts land just before the history', () => {
    const task = prompt({ id: 'task' })
    const items: PromptItem[] = [{ type: 'message-history' }, task]

    expect(ensurePromptMarkers(items, ['agent-prompts'])).toEqual([
      { type: 'agent-prompts' },
      { type: 'message-history' },
      task,
    ])
  })

  test('is idempotent and only adds the requested markers', () => {
    const items: PromptItem[] = [prompt({ id: 'system' })]
    const once = ensurePromptMarkers(items, AGENT_MARKERS)

    expect(once).toEqual([
      prompt({ id: 'system' }),
      { type: 'system-boundary' },
      { type: 'message-history' },
    ])
    expect(ensurePromptMarkers(once, AGENT_MARKERS)).toEqual(once)
  })
})
