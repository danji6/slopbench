import { _fail } from '@sb/convex/model/stream/lifecycle'
import { describe, expect, test } from 'bun:test'
import { fakeCtx } from '~/tests/helpers/stream-lifecycle'

describe('_fail', () => {
  /** The reaper settles a turn the same way a stop does. */
  test('settles a tool call the failed turn never answered', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      state: {
        phase: 'streaming',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
      command: { kind: 'invoke' },
    }
    const { ctx, patches } = fakeCtx({
      docs: [stream, { _id: 'message_1', selectedVersion: 1 }],
      contents: [
        {
          _id: 'content_1',
          version: 1,
          segmentIndex: 0,
          parts: [
            { type: 'tool-shell', toolCallId: 'c1', state: 'input-available' },
          ],
        },
      ],
    })

    await _fail(ctx, {
      generation: 0,
      streamId: stream._id as never,
      message: 'Stream interrupted before completion.',
    })

    const sealed = patches.find(
      ({ id, patch }) => id === 'content_1' && Array.isArray(patch.parts),
    )
    expect((sealed?.patch.parts as unknown[])[0]).toMatchObject({
      state: 'output-error',
    })
    expect(sealed?.patch.metadata).toMatchObject({
      error: 'Stream interrupted before completion.',
    })
  })

  test('a failed compaction no longer claims to be the context boundary', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      command: { kind: 'compact' },
      state: {
        phase: 'streaming',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    }
    const { ctx, patches } = fakeCtx({
      docs: [
        stream,
        {
          _id: 'message_1',
          _creationTime: 10,
          selectedVersion: 1,
          type: 'summary',
        },
      ],
      contents: [{ _id: 'content_1', version: 1, segmentIndex: 0, parts: [] }],
    })

    await _fail(ctx, {
      generation: 0,
      streamId: stream._id as never,
      message: 'Provider overloaded.',
    })

    expect(patches).toContainEqual({
      id: 'message_1',
      patch: { type: undefined },
    })
  })

  test('a failed regular turn keeps its type untouched', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      command: { kind: 'invoke' },
      state: {
        phase: 'streaming',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    }
    const { ctx, patches } = fakeCtx({
      docs: [
        stream,
        { _id: 'message_1', _creationTime: 10, selectedVersion: 1 },
      ],
      contents: [{ _id: 'content_1', version: 1, segmentIndex: 0, parts: [] }],
    })

    await _fail(ctx, {
      generation: 0,
      streamId: stream._id as never,
      message: 'Stream interrupted before completion.',
    })

    expect(
      patches.some(({ id, patch }) => id === 'message_1' && 'type' in patch),
    ).toBe(false)
  })
})
