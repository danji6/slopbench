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
  splitAtMessageHistory,
} from '@sb/convex/model/prompt/prompts'
import type { Prompt } from '@sb/convex/types'
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
      [
        ...beforeHistory,
        normalSystem,
        { id: 'history', type: 'message-history' },
        normalUser,
      ],
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
