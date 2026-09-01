/// <reference types="bun-types" />
import { createAskTool } from '@sb/convex/model/tool/ask'
import {
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk,
  convertToModelMessages,
  readUIMessageStream,
} from 'ai'
import { describe, expect, test } from 'bun:test'

describe('client tool stream resume', () => {
  test('attaches an answer to the seeded request', async () => {
    const initial = {
      id: 'assistant',
      role: 'assistant',
      parts: [
        {
          type: 'tool-ask',
          toolCallId: 'call-1',
          state: 'input-available',
          input: {
            questions: [
              {
                question: 'Pick one',
                options: [{ label: 'A' }, { label: 'B' }],
              },
            ],
          },
        },
      ],
    } as unknown as UIMessage
    const output = {
      answeredBy: 'Ada',
      answers: [{ questionIndex: 0, question: 'Pick one', answer: 'A' }],
    }
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'call-1',
          output,
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
      type: 'tool-ask',
      toolCallId: 'call-1',
      state: 'output-available',
      output,
    })

    const history = await convertToModelMessages([messages.at(-1)!], {
      tools: { ask: await createAskTool() },
    })
    const toolResult = history
      .filter(
        (message): message is Extract<ModelMessage, { role: 'tool' }> =>
          message.role === 'tool',
      )
      .flatMap(({ content }) => content)
      .find((part) => part.type === 'tool-result')
    expect(toolResult).toMatchObject({
      toolName: 'ask',
      output: { type: 'json', value: output },
    })
  })

  test('exposes a user-aborted request to the next provider step', async () => {
    const output = {
      aborted: true as const,
      reason: 'The user aborted this question request.',
    }
    const message = {
      id: 'assistant',
      role: 'assistant',
      parts: [
        {
          type: 'tool-ask',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {
            questions: [
              {
                question: 'Pick one',
                options: [{ label: 'A' }, { label: 'B' }],
              },
            ],
          },
          output,
        },
      ],
    } as unknown as UIMessage

    const history = await convertToModelMessages([message], {
      tools: { ask: await createAskTool() },
    })
    const toolResult = history
      .filter(
        (item): item is Extract<ModelMessage, { role: 'tool' }> =>
          item.role === 'tool',
      )
      .flatMap(({ content }) => content)
      .find((part) => part.type === 'tool-result')

    expect(toolResult).toMatchObject({
      toolName: 'ask',
      output: { type: 'json', value: output },
    })
  })
})
