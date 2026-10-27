import { _claim } from '@sb/convex/model/stream/lifecycle'
import { describe, expect, test } from 'bun:test'
import { fakeCtx } from '~/tests/helpers/stream-lifecycle'

describe('_claim', () => {
  test('computes the boundary for a fresh (empty) processing message', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      attempt: 0,
      contextBoundaryMessageId: 'old_boundary',
      contextBoundaryCreationTime: 1,
      state: {
        phase: 'pending',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
      command: { kind: 'invoke' },
    }
    const { ctx, patches } = fakeCtx({
      docs: [stream, { _id: 'message_1', _creationTime: 60 }],
      contents: [{ _id: 'content_1', segmentIndex: 0, parts: [] }],
      firstMessage: { _id: 'user_2', _creationTime: 50 },
    })

    const result = await _claim(ctx, {
      generation: 0,
      streamId: stream._id as never,
    })

    expect(result?.contextBoundaryMessageId).toBe('user_2' as never)
    expect(result?.state.processingMessageId).toBe('message_1' as never)
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        contextBoundaryMessageId: 'user_2',
        contextBoundaryCreationTime: 50,
      }),
    })
  })

  test('a post-split empty segment keeps the boundary', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      attempt: 0,
      contextBoundaryMessageId: 'user_1',
      contextBoundaryCreationTime: 10,
      command: { kind: 'invoke' },
      state: {
        phase: 'pending',
        processingMessageId: 'message_1',
        processingContentId: 'content_2',
      },
    }
    const { ctx, patches } = fakeCtx({
      docs: [stream, { _id: 'message_1', _creationTime: 60 }],
      // The active segment is empty but it is not the turn's first one
      contents: [{ _id: 'content_2', segmentIndex: 1, parts: [] }],
      firstMessage: { _id: 'user_2', _creationTime: 50 },
    })

    const result = await _claim(ctx, {
      generation: 0,
      streamId: stream._id as never,
    })

    expect(result?.contextBoundaryMessageId).toBe('user_1' as never)
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        contextBoundaryMessageId: 'user_1',
        contextBoundaryCreationTime: 10,
      }),
    })
  })

  test('creates the processing message when a pending turn starts', async () => {
    const stream = {
      _id: 'stream_1',
      sessionId: 'session_1',
      agentId: 'agent_1',
      invokedBy: 'user_1',
      attempt: 0,
      command: { kind: 'invoke' },
      state: { phase: 'pending' },
    }
    const { ctx, patches, inserts } = fakeCtx({
      docs: [stream, { _id: 'agent_1', name: 'Agent', ownerId: 'owner_1' }],
      settings: { _id: 'settings_1', ownerId: 'owner_1' },
      // The newest done message becomes the context boundary.
      firstMessage: { _id: 'user_2', _creationTime: 50 },
    })

    const result = await _claim(ctx, {
      generation: 0,
      streamId: stream._id as never,
    })

    // Message doc + its (v1, seg0) content row are inserted lazily here.
    expect(inserts.map(({ table }) => table)).toEqual([
      'messages',
      'messageContents',
    ])
    expect(result?.state.processingMessageId).toBe('inserted_1' as never)
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        contextBoundaryMessageId: 'user_2',
        contextBoundaryCreationTime: 50,
        state: expect.objectContaining({
          phase: 'streaming',
          processingMessageId: 'inserted_1',
          processingContentId: 'inserted_2',
        }),
      }),
    })
  })

  test('runs an approved tool before consuming a message sent during the approval pause', async () => {
    const stream = {
      _id: 'stream_1',
      _creationTime: 30,
      sessionId: 'session_1',
      invokedBy: 'user_1',
      attempt: 0,
      contextBoundaryMessageId: 'user_1',
      contextBoundaryCreationTime: 10,
      command: { kind: 'invoke' },
      state: {
        phase: 'pending',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    }
    const { ctx, patches, inserts } = fakeCtx({
      docs: [
        stream,
        // The turn's own output message, created after the stream itself
        {
          _id: 'message_1',
          _creationTime: 40,
          selectedVersion: 1,
          sender: { type: 'agent', id: 'agent_1' },
        },
      ],
      contents: [
        {
          _id: 'content_1',
          messageId: 'message_1',
          version: 1,
          segmentIndex: 0,
          parts: [{ type: 'tool-shell', state: 'approval-responded' }],
        },
      ],
      // A user message sent while parked on the approval
      firstMessage: { _id: 'user_2', _creationTime: 50 },
    })

    const result = await _claim(ctx, {
      generation: 0,
      streamId: stream._id as never,
    })

    // Keep streaming into the issuing turn so the approved call can execute.
    // The newer message is consumed after the tool produces its output.
    expect(inserts.some(({ table }) => table === 'messages')).toBe(false)
    expect(patches.some(({ id }) => id === 'message_1')).toBe(false)
    expect(result?.state.processingMessageId).toBe('message_1' as never)
    expect(result?.contextBoundaryMessageId).toBe('user_1' as never)
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        contextBoundaryMessageId: 'user_1',
        contextBoundaryCreationTime: 10,
      }),
    })
  })

  test('keeps the boundary when resuming a pre-existing message (/resume)', async () => {
    const stream = {
      _id: 'stream_1',
      _creationTime: 60,
      sessionId: 'session_1',
      invokedBy: 'user_1',
      attempt: 0,
      contextBoundaryMessageId: 'user_1',
      contextBoundaryCreationTime: 10,
      command: { kind: 'invoke' },
      state: {
        phase: 'pending',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    }
    const { ctx, patches, inserts } = fakeCtx({
      docs: [
        stream,
        // An older agent message being resumed: newer transcript messages exist
        {
          _id: 'message_1',
          _creationTime: 20,
          selectedVersion: 1,
          sender: { type: 'agent', id: 'agent_1' },
        },
      ],
      contents: [
        {
          _id: 'content_1',
          messageId: 'message_1',
          version: 1,
          segmentIndex: 0,
          parts: [{ type: 'text', text: 'partial' }],
        },
      ],
      firstMessage: { _id: 'user_2', _creationTime: 50 },
    })

    const result = await _claim(ctx, {
      generation: 0,
      streamId: stream._id as never,
    })

    // No rollover: the resumed message keeps streaming into itself
    expect(inserts.some(({ table }) => table === 'messages')).toBe(false)
    expect(patches.some(({ id }) => id === 'message_1')).toBe(false)
    expect(result?.state.processingMessageId).toBe('message_1' as never)
    expect(result?.contextBoundaryMessageId).toBe('user_1' as never)
  })

  test('never rolls over a retry stream, even with newer messages', async () => {
    const stream = {
      _id: 'stream_1',
      _creationTime: 30,
      sessionId: 'session_1',
      invokedBy: 'user_1',
      attempt: 0,
      contextBoundaryMessageId: 'user_1',
      contextBoundaryCreationTime: 10,
      command: { kind: 'retry' },
      state: {
        phase: 'pending',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    }
    const { ctx, patches, inserts } = fakeCtx({
      docs: [
        stream,
        {
          _id: 'message_1',
          _creationTime: 40,
          selectedVersion: 2,
          sender: { type: 'agent', id: 'agent_1' },
        },
      ],
      contents: [
        {
          _id: 'content_1',
          messageId: 'message_1',
          version: 2,
          segmentIndex: 0,
          parts: [{ type: 'text', text: 'regenerating' }],
        },
      ],
      firstMessage: { _id: 'user_2', _creationTime: 50 },
    })

    const result = await _claim(ctx, {
      generation: 0,
      streamId: stream._id as never,
    })

    expect(inserts.some(({ table }) => table === 'messages')).toBe(false)
    expect(patches.some(({ id }) => id === 'message_1')).toBe(false)
    expect(result?.contextBoundaryMessageId).toBe('user_1' as never)
  })
})
