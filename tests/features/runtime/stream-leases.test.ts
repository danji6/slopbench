import { STREAM_LEASE_MS } from '@sb/convex/model/stream/lease'
import {
  _heartbeat,
  _honorSoftStop,
  _patchMessage,
} from '@sb/convex/model/stream/lifecycle'
import { _getStopState } from '@sb/convex/model/stream/reads'
import { requestImmediateStop } from '@sb/convex/model/stream/stop'
import { describe, expect, test } from 'bun:test'
import { fakeCtx } from '~/tests/helpers/stream-lifecycle'

describe('stream stop contention', () => {
  test('token patches and heartbeats keep a valid lease without rewriting the stream', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
      state: {
        phase: 'streaming',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
      command: { kind: 'invoke' },
    }
    const { ctx, patches } = fakeCtx({
      docs: [stream],
      contents: [
        {
          _id: 'content_1',
          messageId: 'message_1',
          version: 1,
          segmentIndex: 0,
          parts: [],
        },
      ],
    })
    expect(
      await _patchMessage(ctx, {
        generation: 0,
        streamId: 'stream_1' as never,
        parts: [{ type: 'text', text: 'token' }],
      }),
    ).toBe(true)
    await _heartbeat(ctx, { generation: 0, streamId: 'stream_1' as never })
    expect(patches.filter(({ id }) => id === 'stream_1')).toEqual([])
    stream.leaseExpiresAt = Date.now() + STREAM_LEASE_MS - 61000
    await _heartbeat(ctx, { generation: 0, streamId: 'stream_1' as never })
    expect(patches.filter(({ id }) => id === 'stream_1')).toHaveLength(1)
    expect(stream.leaseExpiresAt).toBeGreaterThan(
      Date.now() + STREAM_LEASE_MS - 1000,
    )
    await _heartbeat(ctx, { generation: 0, streamId: 'stream_1' as never })
    expect(patches.filter(({ id }) => id === 'stream_1')).toHaveLength(1)
  })

  test('stop checks use a read snapshot; repeated stop requests never reschedule finalization', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
      state: { phase: 'streaming', processingMessageId: 'message_1' },
      command: { kind: 'invoke' },
    }
    const { ctx, patches, scheduled } = fakeCtx({ docs: [stream] })
    expect(
      await _getStopState(ctx, {
        generation: 0,
        streamId: 'stream_1' as never,
      }),
    ).toBe('active')
    expect(
      await _honorSoftStop(ctx, {
        generation: 0,
        streamId: 'stream_1' as never,
      }),
    ).toBe(false)
    expect(patches).toEqual([])
    expect(await requestImmediateStop(ctx, stream as never)).toBe('finalizing')
    const count = patches.length
    await requestImmediateStop(ctx, stream as never)
    await _honorSoftStop(ctx, { generation: 0, streamId: 'stream_1' as never })
    await _heartbeat(ctx, { generation: 0, streamId: 'stream_1' as never })
    expect(patches).toHaveLength(count)
    expect(scheduled).toHaveLength(1)
    expect(
      await _getStopState(ctx, {
        generation: 0,
        streamId: 'stream_1' as never,
      }),
    ).toBe('stopped')
    expect(
      await _getStopState(ctx, { generation: 0, streamId: 'missing' as never }),
    ).toBe('stopped')
  })

  test('read-only stop checks still distinguish a soft timeout from active streaming', async () => {
    const { ctx, patches, scheduled } = fakeCtx({
      docs: [
        {
          _id: 'stream_1',
          stopAt: Date.now(),
          state: { phase: 'streaming' },
          command: { kind: 'invoke' },
        },
      ],
    })
    expect(
      await _getStopState(ctx, {
        generation: 0,
        streamId: 'stream_1' as never,
      }),
    ).toBe('requested')
    expect(patches).toEqual([])
    expect(scheduled).toEqual([])
    expect(
      await _honorSoftStop(ctx, {
        generation: 0,
        streamId: 'stream_1' as never,
      }),
    ).toBe(true)
    expect(
      await _getStopState(ctx, {
        generation: 0,
        streamId: 'stream_1' as never,
      }),
    ).toBe('stopped')
  })
})
