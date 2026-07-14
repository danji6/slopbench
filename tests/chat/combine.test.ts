/// <reference types="bun-types" />
import { combineTurns } from '@/lib/chat/combine'
import type { UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

type Part = UIMessage['parts'][number]

function assistant(order: number, parts: Part[], id = `m${order}`): UIMessage {
  return { id, role: 'assistant', parts, order } as unknown as UIMessage
}

function text(value: string): Part {
  return { type: 'text', text: value } as Part
}

function tool(toolCallId: string, state: string, extra: object = {}): Part {
  return { type: 'tool-web', toolCallId, state, ...extra } as unknown as Part
}

describe('combineTurns', () => {
  test('merges consecutive same-order assistant steps into one bubble', () => {
    const messages = [
      { id: 'u', role: 'user', parts: [text('hi')], order: 0 },
      assistant(1, [text('Hello')], 'step1'),
      assistant(1, [tool('call-1', 'output-available')], 'step2'),
    ] as unknown as UIMessage[]

    const result = combineTurns(messages)

    expect(result).toHaveLength(2)
    expect(result[1].id).toBe('step1')
    expect(result[1].parts).toHaveLength(2)
  })

  test('preserves source message ids on merged tool parts', () => {
    const messages = [
      assistant(1, [text('Running')], 'step1'),
      assistant(
        1,
        [tool('call-1', 'approval-requested', { approval: { id: 'a1' } })],
        'step2',
      ),
    ]

    const [combined] = combineTurns(messages)

    expect(combined.parts[1]).toMatchObject({
      toolCallId: 'call-1',
      sourceMessageId: 'step2',
    })
  })

  test('does not merge across different orders', () => {
    const messages = [assistant(1, [text('a')]), assistant(2, [text('b')])]

    expect(combineTurns(messages)).toHaveLength(2)
  })

  test('dedupes a tool by toolCallId, preferring the error state', () => {
    const messages = [
      assistant(1, [tool('call-1', 'output-available', { output: 'ok' })]),
      assistant(1, [tool('call-1', 'output-error', { errorText: 'boom' })]),
    ]

    const [combined] = combineTurns(messages)
    expect(combined.parts).toHaveLength(1)
    expect((combined.parts[0] as { state: string }).state).toBe('output-error')
  })

  test('dedupes identical text and drops empty text parts', () => {
    const messages = [
      assistant(1, [text('Hello world')]),
      assistant(1, [text('Hello world'), text('   ')]),
    ]

    const [combined] = combineTurns(messages)
    expect(combined.parts).toHaveLength(1)
    expect((combined.parts[0] as { text: string }).text).toBe('Hello world')
  })

  test('leaves non-grouped messages untouched (no order metadata)', () => {
    const messages = [
      { id: 'a', role: 'assistant', parts: [text('x')] },
      { id: 'b', role: 'assistant', parts: [text('y')] },
    ] as unknown as UIMessage[]

    expect(combineTurns(messages)).toHaveLength(2)
  })
})
