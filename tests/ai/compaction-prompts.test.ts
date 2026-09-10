/// <reference types="bun-types" />
import {
  type PromptEvalResult,
  createOperationPlan,
} from '@sb/convex/actions/stream/operations'
import {
  createDefaultCompactionPrompts,
  createDefaultImpersonationPrompts,
} from '@sb/convex/model/defaults'
import {
  buildPrompts,
  buildSystemPrompt,
  resolveCompactionPrompts,
  resolveImpersonationPrompts,
} from '@sb/convex/model/prompt/prompts'
import type { Prompt, PromptItem, StreamContext } from '@sb/convex/types'
import { evaluate } from '@sb/core/interpreter/evaluate'
import { createVariableStore } from '@sb/core/interpreter/store'
import { describe, expect, test } from 'bun:test'

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

function data(
  operation: 'compact' | 'impersonate',
  own: PromptItem[],
  trailing: Prompt[],
  instructions?: string,
) {
  return {
    agent: {},
    session: {},
    settings: {},
    stream: { _id: 'stream', operation, instructions },
    prompts: {
      own,
      library: [],
      compaction: trailing,
      impersonation: trailing,
    },
    sessionCache: { items: [prompt({ id: 'stale-snapshot' })] },
  } as unknown as StreamContext
}

function render(items: PromptItem[]): PromptEvalResult {
  const store = createVariableStore()
  return {
    items: items.map((item) =>
      'type' in item || !item.enabled
        ? item
        : {
            ...item,
            content: evaluate(item.content, { user: 'Alice' }, store),
          },
    ),
    environment: store.toRecord(),
    dirty: store.isDirty(),
  }
}

const history = [
  {
    _id: 'message',
    role: 'user',
    sender: { type: 'user', id: 'user' },
    parts: [{ type: 'text', text: 'Hello' }],
  },
]
const ctx = { runQuery: async () => history } as never

for (const operation of ['compact', 'impersonate'] as const) {
  describe(`${operation} appended prompts`, () => {
    test('keeps agent layout and appends enabled prompts in exact order before command instructions', async () => {
      const own = [
        prompt({ id: 'system' }),
        { type: 'message-history' } as const,
        prompt({ id: 'post', role: 'assistant' }),
        prompt({ id: 'starter', starter: true }),
      ]
      // Repeated IDs across scopes must not affect the positional boundary.
      const trailing = [
        prompt({ id: 'post', role: 'user', content: 'First' }),
        prompt({ id: 'off', enabled: false }),
        prompt({ id: 'last', content: 'Last' }),
      ]
      const input = data(operation, own, trailing, '  Extra instructions  ')
      const plan = createOperationPlan(input)
      expect(plan.evalItems).toEqual([...own.slice(0, -1), ...trailing])
      expect(plan.toolNames).toEqual([])
      expect(plan.snapshotPatch(render(plan.evalItems))).toBeNull()
      const request = await plan.buildRequest(
        ctx,
        input,
        render(plan.evalItems),
      )
      expect(request.tools).toEqual({})
      expect(request.systemPrompt).toBe('system content.')
      expect(request.messages).toEqual([
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        { role: 'assistant', content: 'post content.' },
        { role: 'user', content: 'First' },
        { role: 'system', content: 'Last' },
        { role: 'user', content: 'Extra instructions' },
      ])
    })

    test('without history markers, operation prompts still follow history', async () => {
      const input = data(
        operation,
        [prompt({ id: 'base' }), prompt({ id: 'before', role: 'user' })],
        [prompt({ id: 'task' })],
      )
      const plan = createOperationPlan(input)
      const request = await plan.buildRequest(
        ctx,
        input,
        render(plan.evalItems),
      )
      expect(request.systemPrompt).toBe('base content.')
      expect(request.messages.map((message) => message.content)).toEqual([
        'before content.',
        [{ type: 'text', text: 'Hello' }],
        'task content.',
      ])
    })

    test('evaluates agent and operation variables sequentially, skipping disabled entries', async () => {
      const input = data(
        operation,
        [prompt({ id: 'agent', content: '{{setVar("value", "agent")}}' })],
        [
          prompt({
            id: 'first',
            content: '{{getVar("value")}} {{setVar("value", "operation")}}',
          }),
          prompt({
            id: 'disabled',
            enabled: false,
            content: '{{setVar("value", "wrong")}}',
          }),
          prompt({ id: 'second', content: '{{getVar("value")}}' }),
        ],
      )
      const plan = createOperationPlan(input)
      const evaluated = render(plan.evalItems)
      const request = await plan.buildRequest(ctx, input, evaluated)
      expect(String(request.messages.at(-2)?.content)).toContain('agent')
      expect(request.messages.at(-1)?.content).toBe('operation')
      expect(evaluated.environment.value).toBe('operation')
    })

    test('an all-disabled override adds no operation prompts or defaults', async () => {
      const input = data(
        operation,
        [],
        [prompt({ id: 'off', enabled: false })],
        ' ',
      )
      const plan = createOperationPlan(input)
      const request = await plan.buildRequest(
        ctx,
        input,
        render(plan.evalItems),
      )
      expect(request.messages).toHaveLength(1)
      expect(request.systemPrompt).toBeUndefined()
    })

    test('empty configuration uses the marker-free defaults', async () => {
      const defaults =
        operation === 'compact'
          ? createDefaultCompactionPrompts()
          : createDefaultImpersonationPrompts()
      const resolve =
        operation === 'compact'
          ? resolveCompactionPrompts
          : resolveImpersonationPrompts
      expect(resolve([])).toEqual(defaults)
      expect(defaults.map((p) => p.role)).toEqual(['system', 'user'])
      expect(defaults.every((p) => !('type' in p))).toBe(true)
      const input = data(operation, [], [])
      const plan = createOperationPlan(input)
      const request = await plan.buildRequest(
        ctx,
        input,
        render(plan.evalItems),
      )
      expect(request.messages.map((m) => m.role)).toEqual([
        'user',
        'system',
        'user',
      ])
      expect(request.systemPrompt).toBeUndefined()
    })
  })
}

describe('system boundary marker', () => {
  test('demotes trailing system prompts to system-role messages', () => {
    const above = prompt({ id: 'above' })
    const below = prompt({ id: 'below' })

    const { systemPrompt, remainingPrompts } = buildSystemPrompt(
      [above, { type: 'system-boundary' }, below],
      (value) => value,
    )
    const messages = buildPrompts(remainingPrompts, [], (value) => value)

    expect(systemPrompt).toBe('above content.')
    expect(messages).toEqual([{ role: 'system', content: 'below content.' }])
  })

  test('a disabled prompt does not evict later system prompts', () => {
    const { systemPrompt, remainingPrompts } = buildSystemPrompt(
      [
        prompt({ id: 'first' }),
        prompt({ id: 'off', enabled: false }),
        prompt({ id: 'last' }),
      ],
      (value) => value,
    )

    expect(systemPrompt).toBe('first content.\nlast content.')
    expect(remainingPrompts).toHaveLength(0)
  })
})
