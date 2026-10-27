import {
  _continue,
  _handoff,
  _recordStep,
} from '@sb/convex/model/stream/lifecycle'
import { MESSAGE_SPLIT_BUDGET_BYTES } from '@sb/core/const'
import { describe, expect, test } from 'bun:test'
import { fakeCtx } from '~/tests/helpers/stream-lifecycle'

describe('_handoff', () => {
  test('reschedules the stream action with a fresh lease', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      state: { phase: 'streaming', processingMessageId: 'message_1' },
      command: { kind: 'invoke' },
    }
    const { ctx, patches, scheduled } = fakeCtx({ docs: [stream] })

    const result = await _handoff(ctx, {
      generation: 0,
      streamId: stream._id as never,
    })

    expect(result).toBe(true)
    expect(scheduled).toContainEqual({
      args: [0, expect.anything(), { streamId: 'stream_1', generation: 1 }],
    })
    const patch = patches.find(
      ({ patch }) => patch.leaseExpiresAt !== undefined,
    )
    expect(patch?.patch.leaseExpiresAt).toBeGreaterThan(Date.now())
  })

  test('leaves a stopping stream alone', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      state: { phase: 'stopping', processingMessageId: 'message_1' },
      command: { kind: 'invoke' },
    }
    const { ctx, patches, scheduled } = fakeCtx({ docs: [stream] })

    const result = await _handoff(ctx, {
      generation: 0,
      streamId: stream._id as never,
    })

    expect(result).toBe(false)
    expect(scheduled).toEqual([])
    expect(patches.find(({ id }) => id === 'stream_1')).toBeUndefined()
  })
})

describe('_continue', () => {
  test('resets retry attempts when continuing the same processing message', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      attempt: 3,
      command: { kind: 'invoke' },
      state: {
        phase: 'streaming',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    }
    const { ctx, patches, inserts } = fakeCtx({
      docs: [stream, { _id: 'message_1', _creationTime: 10 }],
      contents: [
        {
          _id: 'content_1',
          version: 1,
          segmentIndex: 0,
          parts: [{ type: 'text', text: 'short' }],
        },
      ],
    })

    await _continue(ctx, { generation: 0, streamId: stream._id as never })

    expect(inserts).toHaveLength(0)
    expect(patches).toContainEqual({
      id: stream._id,
      patch: expect.objectContaining({ attempt: 0 }),
    })
  })

  test('splits an over-cap turn into a fresh segment', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      invokedBy: 'user_1',
      attempt: 3,
      contextBoundaryMessageId: 'user_0',
      contextBoundaryCreationTime: 5,
      command: { kind: 'invoke' },
      state: {
        phase: 'streaming',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    }
    const bigParts = [
      { type: 'text', text: 'x'.repeat(MESSAGE_SPLIT_BUDGET_BYTES + 1) },
    ]
    const message = {
      _id: 'message_1',
      _creationTime: 10,
      sessionId: 'session_1',
      status: 'processing',
      sender: { type: 'agent', id: 'agent_1' },
      senderName: 'Agent',
    }
    const { ctx, patches, inserts } = fakeCtx({
      docs: [stream, message],
      contents: [
        {
          _id: 'content_1',
          messageId: 'message_1',
          sessionId: 'session_1',
          version: 1,
          segmentIndex: 0,
          parts: bigParts,
          metadata: { duration: 5 },
        },
      ],
    })

    await _continue(ctx, { generation: 0, streamId: stream._id as never })

    // The over-cap segment is sealed with its search text and metadata
    expect(patches).toContainEqual({
      id: 'content_1',
      patch: expect.objectContaining({
        parts: bigParts,
        metadata: { duration: 5 },
      }),
    })
    // No new message doc: an empty follow-up segment is appended instead
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe('messageContents')
    expect(inserts[0].fields).toMatchObject({
      messageId: 'message_1',
      version: 1,
      segmentIndex: 1,
      parts: [],
    })
    // The doc stays processing and exposes the new mutable tail to readers
    expect(patches).toContainEqual({
      id: 'message_1',
      patch: { activeSegmentIndex: 1 },
    })
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        state: expect.objectContaining({ processingContentId: 'inserted_1' }),
        attempt: 0,
      }),
    })
    const streamPatch = patches.find(({ id }) => id === 'stream_1')
    expect(streamPatch?.patch.contextBoundaryMessageId).toBeUndefined()
  })

  test('never splits a compaction summary', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      attempt: 0,
      command: { kind: 'compact' },
      state: {
        phase: 'streaming',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    }
    const bigParts = [
      { type: 'text', text: 'x'.repeat(MESSAGE_SPLIT_BUDGET_BYTES + 1) },
    ]
    const { ctx, patches, inserts } = fakeCtx({
      docs: [stream, { _id: 'message_1', _creationTime: 10 }],
      contents: [
        { _id: 'content_1', version: 1, segmentIndex: 0, parts: bigParts },
      ],
    })

    await _continue(ctx, { generation: 0, streamId: stream._id as never })

    expect(inserts).toHaveLength(0)
    expect(patches).toContainEqual({
      id: stream._id,
      patch: expect.objectContaining({ attempt: 0 }),
    })
  })

  test('interleaved newer message finalizes the turn and rolls over', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      attempt: 0,
      command: { kind: 'invoke' },
      state: {
        phase: 'streaming',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    }
    const message = {
      _id: 'message_1',
      _creationTime: 10,
      sessionId: 'session_1',
      selectedVersion: 1,
      sender: { type: 'agent', id: 'agent_1' },
    }
    const { ctx, patches, inserts } = fakeCtx({
      docs: [stream, message],
      contents: [
        {
          _id: 'content_1',
          version: 1,
          segmentIndex: 0,
          parts: [{ type: 'text', text: 'hi' }],
        },
      ],
      firstMessage: { _id: 'user_2', _creationTime: 20 },
    })

    await _continue(ctx, { generation: 0, streamId: stream._id as never })

    // The interrupted turn is sealed...
    expect(patches).toContainEqual({
      id: 'message_1',
      patch: expect.objectContaining({ status: 'done' }),
    })
    // ...and a fresh output message takes over with the new boundary
    const rollover = inserts.find(({ table }) => table === 'messages')
    expect(rollover?.fields).toMatchObject({ status: 'processing' })
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        contextBoundaryMessageId: 'user_2',
        contextBoundaryCreationTime: 20,
      }),
    })
  })

  test('a command chip is not an interjection and never rolls the turn over', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      attempt: 0,
      command: { kind: 'invoke' },
      state: {
        phase: 'streaming',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    }
    const message = {
      _id: 'message_1',
      _creationTime: 10,
      sessionId: 'session_1',
      selectedVersion: 1,
      sender: { type: 'agent', id: 'agent_1' },
    }
    const { ctx, patches, inserts } = fakeCtx({
      docs: [stream, message],
      contents: [
        {
          _id: 'content_1',
          version: 1,
          segmentIndex: 0,
          parts: [{ type: 'text', text: 'hi' }],
        },
      ],
      firstMessage: {
        _id: 'chip_1',
        _creationTime: 20,
        type: 'command',
        sender: { type: 'user', id: 'user_1' },
      },
    })

    await _continue(ctx, { generation: 0, streamId: stream._id as never })

    expect(inserts.some(({ table }) => table === 'messages')).toBe(false)
    expect(patches.some(({ id }) => id === 'message_1')).toBe(false)
  })

  // Approval/task parking moved to _suspendStep (see subagent-lifecycle.test.ts)
})

describe('_recordStep', () => {
  test('advances the hot clock for a completed invoke step', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      invokedBy: 'user_1',
      command: { kind: 'invoke' },
      state: { phase: 'streaming' },
    }
    const state = {
      _id: 'state_1',
      sessionId: 'session_1',
      stepCount: 4,
      updatedAt: 1,
    }
    const { ctx, patches, inserts } = fakeCtx({ docs: [stream, state] })

    expect(
      await _recordStep(ctx, {
        generation: 0,
        streamId: stream._id as never,
        interruptible: false,
      }),
    ).toBe(true)

    expect(patches).toContainEqual({
      id: 'state_1',
      patch: expect.objectContaining({ stepCount: 5 }),
    })
    expect(inserts).toEqual([])
  })

  test('injects the normal-mode note at a safe continuation', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      invokedBy: 'user_1',
      command: { kind: 'invoke' },
      state: { phase: 'streaming' },
    }
    const session = {
      _id: 'session_1',
      activeAgentId: 'agent_1',
      announcedMode: 'plan',
    }
    const agent = {
      _id: 'agent_1',
      ownerId: 'owner_1',
      name: 'Agent',
      tools: ['plan'],
    }
    const state = {
      _id: 'state_1',
      sessionId: 'session_1',
      stepCount: 2,
      updatedAt: 1,
    }
    const { ctx, patches, inserts } = fakeCtx({
      docs: [stream, session, agent, state],
      settings: { _id: 'settings_1', ownerId: 'owner_1' },
    })

    await _recordStep(ctx, {
      generation: 0,
      streamId: stream._id as never,
      interruptible: true,
    })

    expect(
      inserts.find(({ table }) => table === 'messages')?.fields,
    ).toMatchObject({
      type: 'mode',
      hidden: true,
      extra: { from: 'plan', to: 'normal' },
    })
    expect(patches).toContainEqual({
      id: 'session_1',
      patch: { announcedMode: 'normal' },
    })
  })

  test('does not count retry streams', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      invokedBy: 'user_1',
      command: { kind: 'retry' },
      state: { phase: 'streaming' },
    }
    const { ctx, patches } = fakeCtx({ docs: [stream] })

    expect(
      await _recordStep(ctx, {
        generation: 0,
        streamId: stream._id as never,
        interruptible: true,
      }),
    ).toBe(false)
    expect(patches).toEqual([])
  })
})
