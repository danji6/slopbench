/// <reference types="bun-types" />
import { trackToolErrors } from '@sb/convex/model/stream/transformers'
import { describe, expect, test } from 'bun:test'

async function drain<T>(stream: ReadableStream<T>): Promise<void> {
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) return
  }
}

function streamOf(chunks: unknown[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

describe('trackToolErrors', () => {
  test('captures errored tool call ids', async () => {
    const tracker = { toolErrors: new Set<string>() }
    const transform = trackToolErrors(tracker)({ tools: {} })

    await drain(
      streamOf([
        { type: 'tool-call', toolCallId: 'good' },
        { type: 'tool-result', toolCallId: 'good' },
        { type: 'tool-call', toolCallId: 'bad' },
        { type: 'tool-error', toolCallId: 'bad', error: 'boom' },
      ]).pipeThrough(transform),
    )

    expect([...tracker.toolErrors]).toEqual(['bad'])
  })

  test('passes chunks through unchanged', async () => {
    const tracker = { toolErrors: new Set<string>() }
    const transform = trackToolErrors(tracker)({ tools: {} })
    const out: unknown[] = []

    const reader = streamOf([{ type: 'text-delta', id: 't', text: 'x' }])
      .pipeThrough(transform)
      .getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      out.push(value)
    }

    expect(out).toEqual([{ type: 'text-delta', id: 't', text: 'x' }])
  })
})
