/// <reference types="bun-types" />
import { type UIMessage, type UIMessageChunk, readUIMessageStream } from 'ai'
import { describe, expect, test } from 'bun:test'

describe('tool approval stream resume', () => {
  test('attaches approved tool output to the seeded invocation', async () => {
    const initial = {
      id: 'assistant',
      role: 'assistant',
      parts: [
        {
          type: 'tool-shell',
          toolCallId: 'call-1',
          state: 'approval-responded',
          input: { command: 'ls' },
          approval: { id: 'approval-1', approved: true },
        },
      ],
    } as unknown as UIMessage

    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'call-1',
          output: 'README.md',
        } as UIMessageChunk)
        controller.close()
      },
    })

    const messages: UIMessage[] = []
    for await (const message of readUIMessageStream({
      message: initial,
      stream,
      terminateOnError: true,
    })) {
      messages.push(message)
    }

    expect(messages.at(-1)?.parts[0]).toMatchObject({
      type: 'tool-shell',
      toolCallId: 'call-1',
      state: 'output-available',
      output: 'README.md',
    })
  })
})
