import {
  _finalizeStopped,
  _honorSoftStop,
} from '@sb/convex/model/stream/lifecycle'
import { describe, expect, test } from 'bun:test'
import { fakeCtx } from '~/tests/helpers/stream-lifecycle'

describe('_honorSoftStop', () => {
  test('a timeout cancels unanswered approval without recording a denial', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      stopAt: Date.now(),
      state: {
        phase: 'streaming',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
      command: { kind: 'invoke' },
    }
    const { ctx, patches, deletes } = fakeCtx({
      docs: [stream, { _id: 'message_1', selectedVersion: 1 }],
      contents: [
        {
          _id: 'content_1',
          version: 1,
          segmentIndex: 0,
          parts: [
            {
              type: 'tool-shell',
              toolCallId: 'shell_1',
              state: 'approval-requested',
              approval: { id: 'approval_1' },
              input: { command: 'pwd' },
            },
          ],
        },
      ],
    })

    expect(
      await _honorSoftStop(ctx, {
        generation: 0,
        streamId: stream._id as never,
      }),
    ).toBe(true)
    await _finalizeStopped(ctx, { streamId: stream._id as never })

    const sealed = patches.find(
      ({ id, patch }) => id === 'content_1' && Array.isArray(patch.parts),
    )
    expect((sealed?.patch.parts as unknown[])[0]).toMatchObject({
      state: 'output-error',
      approval: undefined,
      errorText:
        'The turn ended before approval was received. This tool call never ran.',
    })
    expect(deletes).toContain(stream._id)
  })

  test('moves a timed-out stream to stopped finalization exactly once', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      stopAt: Date.now(),
      state: { phase: 'streaming' },
      command: { kind: 'invoke' },
    }
    const { ctx, patches, scheduled } = fakeCtx({ docs: [stream] })

    expect(
      await _honorSoftStop(ctx, {
        generation: 0,
        streamId: stream._id as never,
      }),
    ).toBe(true)
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: { suppressFollowUp: true, state: { phase: 'stopping' } },
    })
    expect(scheduled).toHaveLength(1)

    await _honorSoftStop(ctx, { generation: 0, streamId: stream._id as never })
    expect(scheduled).toHaveLength(1)
  })
})

describe('_finalizeStopped', () => {
  test.each([
    { parts: [] },
    { parts: [{ type: 'step-start' }, { type: 'text', text: '' }] },
  ])(
    'restores the selected version when Retry is stopped before output (%j)',
    async ({ parts }) => {
      const message = {
        _id: 'message_1',
        selectedVersion: 3,
        versionCount: 3,
      }
      const stream = {
        _id: 'stream_1',
        sessionId: 'session_1',
        command: { kind: 'retry', previousVersion: 1 },
        state: {
          phase: 'stopping',
          processingMessageId: 'message_1',
          processingContentId: 'content_3',
        },
      }
      const { ctx, deletes, scheduled } = fakeCtx({
        docs: [
          stream,
          message,
          {
            _id: 'content_3',
            version: 3,
            segmentIndex: 0,
            parts,
          },
        ],
        contents: [
          {
            _id: 'content_1',
            version: 1,
            segmentIndex: 0,
            parts: [{ type: 'text', text: 'Original response' }],
            senderName: 'Original agent',
            metadata: { duration: 100 },
          },
        ],
      })

      await _finalizeStopped(ctx, { streamId: stream._id as never })

      expect(message).toMatchObject({
        selectedVersion: 1,
        versionCount: 2,
        status: 'done',
        senderName: 'Original agent',
        contextEligible: true,
        metadata: { duration: 100 },
      })
      expect(deletes).toEqual(['content_3', 'stream_1'])
      expect(scheduled).not.toContainEqual({
        args: [
          0,
          expect.anything(),
          expect.objectContaining({ messageId: 'message_1' }),
        ],
      })
    },
  )

  test('keeps partial Retry output when stopped', async () => {
    const message = { _id: 'message_1', selectedVersion: 2, versionCount: 2 }
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      command: { kind: 'retry', previousVersion: 1 },
      state: {
        phase: 'stopping',
        processingMessageId: 'message_1',
        processingContentId: 'content_2',
      },
    }
    const { ctx, deletes } = fakeCtx({
      docs: [stream, message],
      contents: [
        {
          _id: 'content_2',
          version: 2,
          segmentIndex: 0,
          parts: [{ type: 'text', text: 'Partial response' }],
        },
      ],
    })
    await _finalizeStopped(ctx, { streamId: stream._id as never })
    expect(message).toMatchObject({
      selectedVersion: 2,
      versionCount: 2,
      status: 'done',
    })
    expect(deletes).toEqual(['stream_1'])
  })

  test('preserves retry errors on the processing message when stopped', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      state: {
        phase: 'stopping',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
        retryError: 'Provider 429: rate limit',
      },
      command: { kind: 'invoke' },
    }
    const message = { _id: 'message_1', selectedVersion: 1 }
    const { ctx, patches, deletes, scheduled } = fakeCtx({
      docs: [stream, message],
      contents: [
        {
          _id: 'content_1',
          version: 1,
          segmentIndex: 0,
          parts: [{ type: 'text', text: 'partial' }],
          metadata: { error: 'Previous error' },
        },
      ],
    })

    await _finalizeStopped(ctx, { streamId: stream._id as never })

    expect(patches).toContainEqual({
      id: 'message_1',
      patch: expect.objectContaining({
        status: 'done',
        metadata: expect.objectContaining({
          error: 'Previous error\nProvider 429: rate limit',
        }),
      }),
    })
    expect(deletes).toEqual(['stream_1'])
    expect(scheduled).toContainEqual({
      args: [0, expect.anything(), { sessionId: 'session_1' }],
    })
  })

  test('settles abandoned task parts so they do not stay running', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      state: {
        phase: 'stopping',
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
            {
              type: 'tool-task',
              toolCallId: 'tc_1',
              state: 'input-available',
            },
          ],
        },
      ],
    })

    await _finalizeStopped(ctx, { streamId: stream._id as never })

    const sealed = patches.find(
      ({ id, patch }) => id === 'content_1' && Array.isArray(patch.parts),
    )
    expect((sealed?.patch.parts as unknown[])[0]).toMatchObject({
      state: 'output-available',
      output: '[The turn ended before the sub-agent could be started.]',
    })
  })

  test('settles an aborted question request as a model-readable result', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      state: {
        phase: 'stopping',
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
            {
              type: 'tool-ask',
              toolCallId: 'ask_1',
              state: 'input-available',
              input: { questions: [] },
            },
          ],
        },
      ],
    })

    await _finalizeStopped(ctx, { streamId: stream._id as never })

    const sealed = patches.find(
      ({ id, patch }) => id === 'content_1' && Array.isArray(patch.parts),
    )
    expect((sealed?.patch.parts as unknown[])[0]).toMatchObject({
      state: 'output-available',
      output: {
        aborted: true,
        reason: 'The user aborted this question request.',
      },
    })
  })

  test('a stopped compaction stops claiming to be a summary', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      command: { kind: 'compact' },
      state: {
        phase: 'stopping',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    }
    const { ctx, patches } = fakeCtx({
      docs: [
        // Claim stamped the summary marker before any content existed
        stream,
        { _id: 'message_1', selectedVersion: 1, type: 'summary' },
      ],
      contents: [{ _id: 'content_1', version: 1, segmentIndex: 0, parts: [] }],
    })

    await _finalizeStopped(ctx, { streamId: stream._id as never })

    // Otherwise the newest-done-summary floor would hide all earlier history
    expect(patches).toContainEqual({
      id: 'message_1',
      patch: { type: undefined },
    })
  })

  /**
   * Stopping between approving a call and running it used to leave the part at
   * `approval-responded` forever: the UI kept spinning, and the next turn sent
   * the provider a tool_call nothing answered, which it rejects outright.
   */
  test('settles a call that was approved but never ran', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      state: {
        phase: 'stopping',
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
            {
              type: 'tool-shell',
              toolCallId: 'shell_15',
              state: 'approval-responded',
              approval: { id: 'a1', approved: true },
              input: { command: './packaging/build.sh' },
            },
          ],
        },
      ],
    })

    await _finalizeStopped(ctx, { streamId: stream._id as never })

    const sealed = patches.find(
      ({ id, patch }) => id === 'content_1' && Array.isArray(patch.parts),
    )
    expect((sealed?.patch.parts as unknown[])[0]).toMatchObject({
      state: 'output-error',
      errorText: expect.stringContaining('turn ended'),
    })
  })
})
