import { trackToolErrors } from '@sb/convex/model/stream/transformers'
import type { TextStreamPart, ToolSet } from 'ai'
import { expect, test } from 'bun:test'
import { collectStream, streamOf } from '~/tests/helpers/streams'

test('tracks errored calls without changing provider stream events', async () => {
  const tracker = { toolErrors: new Set<string>() }
  const call = { toolName: 'fixture', input: {} }
  const chunks: TextStreamPart<ToolSet>[] = [
    { type: 'text-delta', id: 't', text: 'x' },
    { ...call, type: 'tool-call', toolCallId: 'good' },
    { ...call, type: 'tool-result', toolCallId: 'good', output: 'ok' },
    { ...call, type: 'tool-call', toolCallId: 'bad' },
    { ...call, type: 'tool-error', toolCallId: 'bad', error: 'boom' },
  ]
  const output = await collectStream(
    streamOf(chunks).pipeThrough(trackToolErrors(tracker)({ tools: {} })),
  )
  expect([...tracker.toolErrors]).toEqual(['bad'])
  expect(output).toEqual(chunks)
})
