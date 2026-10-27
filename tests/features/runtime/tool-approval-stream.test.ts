/// <reference types="bun-types" />
import {
  collectRespondedApprovalNotes,
  insertApprovalNoteMessages,
} from '@sb/convex/actions/stream/history'
import { getProviderOptions } from '@sb/convex/model/provider/options'
import {
  type UIMessage,
  type UIMessageChunk,
  convertToModelMessages,
  readUIMessageStream,
  streamText,
  tool,
} from 'ai'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

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

  test('sends the approval note separately from the tool output', async () => {
    const toolDefinition = tool({
      inputSchema: z.object({ path: z.string() }),
      needsApproval: () => true,
      execute: async () => 'File written.',
    })
    const initial = {
      id: 'assistant',
      role: 'assistant',
      parts: [
        {
          type: 'tool-write_file',
          toolCallId: 'call-1',
          state: 'approval-responded',
          input: { path: 'notes.txt' },
          approval: {
            id: 'approval-1',
            approved: true,
            note: 'Use the shorter heading.',
          },
        },
      ],
    } as unknown as UIMessage
    const messages = await convertToModelMessages([initial], {
      tools: { write_file: toolDefinition },
    })
    const bodies: Record<string, unknown>[] = []
    const options = await getProviderOptions(
      'gpt-test',
      'none',
      {
        providerId: 'openai',
        apiKey: 'test-key',
        model: { id: 'gpt-test' },
      },
      undefined,
      captureStreamFetch(bodies),
    )
    const notes = collectRespondedApprovalNotes(initial.parts)
    const result = streamText({
      model: options.languageModel,
      messages,
      tools: { write_file: toolDefinition },
      prepareStep: ({ messages: stepMessages }) => ({
        messages: insertApprovalNoteMessages(stepMessages, notes),
      }),
    })

    for await (const _ of result.fullStream);

    const input = bodies[0]?.input as
      | Array<{
          type?: string
          output?: string
          role?: string
          content?: Array<{ type?: string; text?: string }>
        }>
      | undefined
    const toolOutput = input?.find(
      (item) => item.type === 'function_call_output',
    )
    const approvalMessage = input?.find(
      (item) =>
        item.role === 'user' &&
        item.content?.some((part) =>
          part.text?.includes('Use the shorter heading.'),
        ),
    )
    expect(toolOutput?.output).toBe('File written.')
    expect(approvalMessage?.content).toEqual([
      {
        type: 'input_text',
        text:
          '<user-note tool="write_file" id="call-1">\n' +
          'Use the shorter heading.\n' +
          '</user-note>',
      },
    ])
  })
})

function captureStreamFetch(bodies: Record<string, unknown>[]) {
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response('data: [DONE]\\n\\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  return fetch as typeof globalThis.fetch
}
