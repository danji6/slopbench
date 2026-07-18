/// <reference types="bun-types" />
import type { ModelMessage } from '@ai-sdk/provider-utils'
import { applyPromptCaching } from '@sb/convex/model/provider/cache'
import { describe, expect, test } from 'bun:test'

const EPHEMERAL = { type: 'ephemeral' }

function cacheControlOf(message: ModelMessage) {
  return (
    message.providerOptions as
      | { anthropic?: { cacheControl?: unknown } }
      | undefined
  )?.anthropic?.cacheControl
}

function history(): ModelMessage[] {
  return [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'second' },
    { role: 'user', content: 'third' },
  ]
}

describe('applyPromptCaching', () => {
  test('marks the system prompt and the last two messages for anthropic', () => {
    const result = applyPromptCaching(
      { systemPrompt: 'be helpful', messages: history() },
      'anthropic',
    )

    expect(result.systemPrompt).toBeUndefined()
    expect(result.messages).toHaveLength(4)

    const [system, first, second, third] = result.messages
    expect(system.role).toBe('system')
    expect(system.content).toBe('be helpful')
    expect(cacheControlOf(system)).toEqual(EPHEMERAL)
    expect(cacheControlOf(first)).toBeUndefined()
    expect(cacheControlOf(second)).toEqual(EPHEMERAL)
    expect(cacheControlOf(third)).toEqual(EPHEMERAL)
  })

  test('marks trailing messages when there is no system prompt', () => {
    const result = applyPromptCaching(
      { systemPrompt: undefined, messages: history() },
      'anthropic',
    )

    expect(result.messages).toHaveLength(3)
    expect(cacheControlOf(result.messages[0])).toBeUndefined()
    expect(cacheControlOf(result.messages[1])).toEqual(EPHEMERAL)
    expect(cacheControlOf(result.messages[2])).toEqual(EPHEMERAL)
  })

  test('preserves existing provider options on marked messages', () => {
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: 'hello',
        providerOptions: { anthropic: { foo: 'bar' }, openai: { baz: 1 } },
      },
    ]

    const [marked] = applyPromptCaching(
      { systemPrompt: undefined, messages },
      'anthropic',
    ).messages

    expect(marked.providerOptions).toEqual({
      anthropic: { foo: 'bar', cacheControl: EPHEMERAL },
      openai: { baz: 1 },
    })
  })

  test('leaves other providers untouched', () => {
    for (const providerId of ['openai', 'ollama', undefined]) {
      const request = { systemPrompt: 'be helpful', messages: history() }
      const result = applyPromptCaching(request, providerId)

      expect(result).toBe(request)
      expect(result.systemPrompt).toBe('be helpful')
      expect(result.messages.every((m) => cacheControlOf(m) === undefined)).toBe(
        true,
      )
    }
  })
})
