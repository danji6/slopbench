/// <reference types="bun-types" />
import {
  DEFAULT_COMPACTION_PROMPT,
  DEFAULT_COMPACTION_SENTINEL_PROMPT,
  createDefaultCompactionPrompts,
} from '@sb/convex/model/defaults'
import {
  buildPromptMessages,
  buildPrompts,
  buildSystemPrompt,
  spliceAgentPrompts,
  splitAtMessageHistory,
} from '@sb/convex/model/prompt/prompts'
import type { Prompt, PromptItem } from '@sb/convex/types'
import type { ModelMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

describe('compaction prompts', () => {
  test('default compaction prompts split around message history', () => {
    const { beforeHistory, afterHistory } = splitAtMessageHistory(
      createDefaultCompactionPrompts(),
    )

    // The instruction and its sentinel both trail the history for cache reuse
    expect(beforeHistory).toHaveLength(0)
    expect(afterHistory).toHaveLength(2)
    expect(afterHistory[0]).toMatchObject({
      role: 'system',
      name: 'Prompt',
    })
    expect(afterHistory[1]).toMatchObject({
      role: 'user',
      name: 'Sentinel',
    })
  })

  test('compact merge appends the compaction prompt and sentinel after history', () => {
    const normalSystem: Prompt = {
      id: 'normal-system',
      name: 'Normal System',
      role: 'system',
      content: 'Normal system prompt.',
      enabled: true,
      visible: false,
      starter: false,
    }
    const normalUser: Prompt = {
      id: 'normal-user',
      name: 'Normal User',
      role: 'user',
      content: 'Normal post-history prompt.',
      enabled: true,
      visible: false,
      starter: false,
    }
    const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]

    const { beforeHistory, afterHistory } = splitAtMessageHistory(
      createDefaultCompactionPrompts(),
    )
    const { systemPrompt, remainingPrompts } = buildSystemPrompt(
      [...beforeHistory, normalSystem, { type: 'message-history' }, normalUser],
      (value) => value,
    )
    const messages = buildPrompts(remainingPrompts, history, (value) => value)
    messages.push(...buildPromptMessages(afterHistory, (value) => value))

    expect(systemPrompt).toContain('Normal system prompt.')
    expect(systemPrompt).not.toContain(DEFAULT_COMPACTION_PROMPT)
    expect(messages.at(-2)).toMatchObject({
      role: 'system',
      content: expect.stringContaining(DEFAULT_COMPACTION_PROMPT),
    })
    expect(messages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining(DEFAULT_COMPACTION_SENTINEL_PROMPT),
    })
  })
})

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

describe('agent prompts marker', () => {
  const agentPrompts: PromptItem[] = [
    prompt({ id: 'agent-system' }),
    { type: 'message-history' },
  ]
  const task = prompt({ id: 'task' })
  const sentinel = prompt({ id: 'sentinel', role: 'user' })

  const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]

  function finish(beforeHistory: PromptItem[], afterHistory: PromptItem[]) {
    const { systemPrompt, remainingPrompts } = buildSystemPrompt(
      beforeHistory,
      (value) => value,
    )
    const messages = buildPrompts(remainingPrompts, history, (value) => value)
    messages.push(...buildPromptMessages(afterHistory, (value) => value))
    return { systemPrompt, messages }
  }

  /** The pre-marker composition: agent prompts always led the framing list. */
  function legacyCompose(framing: PromptItem[], agents: PromptItem[]) {
    const { beforeHistory, afterHistory } = splitAtMessageHistory(framing)
    return finish([...beforeHistory, ...agents], afterHistory)
  }

  function compose(framing: PromptItem[], agents: PromptItem[]) {
    const { beforeHistory, afterHistory } = splitAtMessageHistory(
      spliceAgentPrompts(framing, agents),
    )
    return finish(beforeHistory, afterHistory)
  }

  test('splices at an explicit marker, consuming it', () => {
    const spliced = spliceAgentPrompts(
      [task, { type: 'agent-prompts' }, sentinel],
      agentPrompts,
    )

    expect(spliced).toEqual([task, ...agentPrompts, sentinel])
  })

  test('marker wins over the message-history fallback', () => {
    const spliced = spliceAgentPrompts(
      [{ type: 'message-history' }, task, { type: 'agent-prompts' }],
      agentPrompts,
    )

    expect(spliced).toEqual([
      { type: 'message-history' },
      task,
      ...agentPrompts,
    ])
  })

  test('without a marker it reproduces the legacy composition', () => {
    const framings: PromptItem[][] = [
      createDefaultCompactionPrompts(),
      [task, { type: 'message-history' }, sentinel],
      [task, sentinel], // no history marker at all
      [],
    ]

    for (const framing of framings) {
      for (const agents of [agentPrompts, [prompt({ id: 'no-marker' })]]) {
        expect(compose(framing, agents)).toEqual(legacyCompose(framing, agents))
      }
    }
  })
})
