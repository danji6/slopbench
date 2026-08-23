/// <reference types="bun-types" />
import {
  _claim,
  _continue,
  _fail,
  _finalizeStopped,
  _handoff,
  pruneOrphanedOutputs,
} from '@sb/convex/model/stream/lifecycle'
import { MESSAGE_SPLIT_BUDGET_BYTES } from '@sb/core/const'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & { _id: string }

/**
 * Minimal stateful db fake: patches merge into the docs so read-after-write
 * matches Convex semantics; `contents` backs messageContents queries.
 */
function fakeCtx({
  docs = [],
  contents = [],
  firstMessage = null,
  settings = null,
}: {
  docs?: Row[]
  contents?: Row[]
  /** Result of `messages` index first() lookups (boundary/newer/latest). */
  firstMessage?: Row | null
  settings?: Row | null
}) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; fields: Record<string, unknown> }> = []
  const deletes: string[] = []
  const scheduled: Array<{ args: unknown[] }> = []
  const deletedBlobs: string[] = []

  const rows = [...contents]
  const byId = new Map<string, Row>(
    [...docs, ...rows].map((row) => [row._id, row]),
  )

  // Enough of a filter builder to evaluate the guards the model applies
  const filterFor = (row: Row) => ({
    field: (name: string) => row[name],
    eq: (a: unknown, b: unknown) => a === b,
    neq: (a: unknown, b: unknown) => a !== b,
  })

  const makeQuery = (table: string) => {
    const predicates: Array<(q: ReturnType<typeof filterFor>) => boolean> = []
    const chain = {
      withIndex: () => chain,
      order: () => chain,
      filter: (next: (q: ReturnType<typeof filterFor>) => boolean) => {
        predicates.push(next)
        return chain
      },
      first: async () => {
        if (table === 'messageContents') return rows[rows.length - 1] ?? null
        if (
          firstMessage &&
          !predicates.every((predicate) => predicate(filterFor(firstMessage)))
        ) {
          return null
        }
        return firstMessage
      },
      unique: async () => (table === 'settings' ? settings : null),
      collect: async () => (table === 'messageContents' ? rows : []),
    }
    return chain
  }

  const ctx = {
    db: {
      get: async (id: string) => byId.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch })
        const doc = byId.get(id)
        if (doc) Object.assign(doc, patch)
      },
      insert: async (table: string, fields: Record<string, unknown>) => {
        inserts.push({ table, fields })
        const id = `inserted_${inserts.length}`
        const row = { _id: id, ...fields }
        byId.set(id, row)
        if (table === 'messageContents') rows.push(row)
        return id
      },
      delete: async (id: string) => {
        deletes.push(id)
        byId.delete(id)
      },
      query: (table: string) => makeQuery(table),
    },
    scheduler: {
      runAfter: async (...args: unknown[]) => {
        scheduled.push({ args })
      },
    },
    storage: {
      delete: async (id: string) => {
        deletedBlobs.push(id)
      },
    },
  } as never

  return { ctx, patches, inserts, deletes, scheduled, deletedBlobs }
}

describe('_claim', () => {
  test('computes the boundary for a fresh (empty) processing message', async () => {
    const stream = {
      _id: 'stream_1',
      status: 'pending',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
      attempt: 0,
      contextBoundaryMessageId: 'old_boundary',
      contextBoundaryCreationTime: 1,
    }
    const { ctx, patches } = fakeCtx({
      docs: [stream, { _id: 'message_1', _creationTime: 60 }],
      contents: [{ _id: 'content_1', segmentIndex: 0, parts: [] }],
      firstMessage: { _id: 'user_2', _creationTime: 50 },
    })

    const result = await _claim(ctx, { streamId: stream._id as never })

    expect(result?.contextBoundaryMessageId).toBe('user_2' as never)
    expect(result?.processingMessageId).toBe('message_1' as never)
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
      status: 'pending',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
      processingContentId: 'content_2',
      operation: 'invoke',
      attempt: 0,
      contextBoundaryMessageId: 'user_1',
      contextBoundaryCreationTime: 10,
    }
    const { ctx, patches } = fakeCtx({
      docs: [stream, { _id: 'message_1', _creationTime: 60 }],
      // The active segment is empty but it is not the turn's first one
      contents: [{ _id: 'content_2', segmentIndex: 1, parts: [] }],
      firstMessage: { _id: 'user_2', _creationTime: 50 },
    })

    const result = await _claim(ctx, { streamId: stream._id as never })

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
      status: 'pending',
      sessionId: 'session_1',
      agentId: 'agent_1',
      invokedBy: 'user_1',
      operation: 'invoke',
      attempt: 0,
      // No processingMessageId yet — it is materialized on claim.
    }
    const { ctx, patches, inserts } = fakeCtx({
      docs: [stream, { _id: 'agent_1', name: 'Agent', ownerId: 'owner_1' }],
      settings: { _id: 'settings_1', ownerId: 'owner_1' },
      // The newest done message becomes the context boundary.
      firstMessage: { _id: 'user_2', _creationTime: 50 },
    })

    const result = await _claim(ctx, { streamId: stream._id as never })

    // Message doc + its (v1, seg0) content row are inserted lazily here.
    expect(inserts.map(({ table }) => table)).toEqual([
      'messages',
      'messageContents',
    ])
    expect(result?.processingMessageId).toBe('inserted_1' as never)
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        status: 'streaming',
        processingMessageId: 'inserted_1',
        processingContentId: 'inserted_2',
        contextBoundaryMessageId: 'user_2',
        contextBoundaryCreationTime: 50,
      }),
    })
  })

  test('runs an approved tool before consuming a message sent during the approval pause', async () => {
    const stream = {
      _id: 'stream_1',
      _creationTime: 30,
      status: 'pending',
      sessionId: 'session_1',
      invokedBy: 'user_1',
      operation: 'invoke',
      attempt: 0,
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
      contextBoundaryMessageId: 'user_1',
      contextBoundaryCreationTime: 10,
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

    const result = await _claim(ctx, { streamId: stream._id as never })

    // Keep streaming into the issuing turn so the approved call can execute.
    // The newer message is consumed after the tool produces its output.
    expect(inserts.some(({ table }) => table === 'messages')).toBe(false)
    expect(patches.some(({ id }) => id === 'message_1')).toBe(false)
    expect(result?.processingMessageId).toBe('message_1' as never)
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
      status: 'pending',
      sessionId: 'session_1',
      invokedBy: 'user_1',
      operation: 'invoke',
      attempt: 0,
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
      contextBoundaryMessageId: 'user_1',
      contextBoundaryCreationTime: 10,
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

    const result = await _claim(ctx, { streamId: stream._id as never })

    // No rollover: the resumed message keeps streaming into itself
    expect(inserts.some(({ table }) => table === 'messages')).toBe(false)
    expect(patches.some(({ id }) => id === 'message_1')).toBe(false)
    expect(result?.processingMessageId).toBe('message_1' as never)
    expect(result?.contextBoundaryMessageId).toBe('user_1' as never)
  })

  test('never rolls over a retry stream, even with newer messages', async () => {
    const stream = {
      _id: 'stream_1',
      _creationTime: 30,
      status: 'pending',
      sessionId: 'session_1',
      invokedBy: 'user_1',
      operation: 'retry',
      attempt: 0,
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
      contextBoundaryMessageId: 'user_1',
      contextBoundaryCreationTime: 10,
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

    const result = await _claim(ctx, { streamId: stream._id as never })

    expect(inserts.some(({ table }) => table === 'messages')).toBe(false)
    expect(patches.some(({ id }) => id === 'message_1')).toBe(false)
    expect(result?.contextBoundaryMessageId).toBe('user_1' as never)
  })
})

describe('_handoff', () => {
  test('reschedules the stream action with a fresh lease', async () => {
    const stream = {
      _id: 'stream_1',
      status: 'streaming',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
    }
    const { ctx, patches, scheduled } = fakeCtx({ docs: [stream] })

    const result = await _handoff(ctx, { streamId: stream._id as never })

    expect(result).toBe(true)
    expect(scheduled).toContainEqual({
      args: [0, expect.anything(), { streamId: 'stream_1' }],
    })
    const patch = patches.find(({ id }) => id === 'stream_1')
    expect(patch?.patch.leaseExpiresAt).toBeGreaterThan(Date.now())
  })

  test('leaves a stopping stream alone', async () => {
    const stream = {
      _id: 'stream_1',
      status: 'stopping',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
    }
    const { ctx, patches, scheduled } = fakeCtx({ docs: [stream] })

    const result = await _handoff(ctx, { streamId: stream._id as never })

    expect(result).toBe(false)
    expect(scheduled).toEqual([])
    expect(patches.find(({ id }) => id === 'stream_1')).toBeUndefined()
  })
})

describe('_continue', () => {
  test('resets retry attempts when continuing the same processing message', async () => {
    const stream = {
      _id: 'stream_1',
      status: 'streaming',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
      operation: 'invoke',
      attempt: 3,
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

    await _continue(ctx, { streamId: stream._id as never })

    expect(inserts).toHaveLength(0)
    expect(patches).toContainEqual({
      id: stream._id,
      patch: expect.objectContaining({ attempt: 0 }),
    })
  })

  test('splits an over-cap turn into a fresh segment', async () => {
    const stream = {
      _id: 'stream_1',
      status: 'streaming',
      sessionId: 'session_1',
      invokedBy: 'user_1',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
      operation: 'invoke',
      attempt: 3,
      contextBoundaryMessageId: 'user_0',
      contextBoundaryCreationTime: 5,
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

    await _continue(ctx, { streamId: stream._id as never })

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
    // The doc stays processing and the context boundary doesn't move
    expect(patches.some(({ id }) => id === 'message_1')).toBe(false)
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        processingContentId: 'inserted_1',
        attempt: 0,
      }),
    })
    const streamPatch = patches.find(({ id }) => id === 'stream_1')
    expect(streamPatch?.patch.contextBoundaryMessageId).toBeUndefined()
  })

  test('never splits a compaction summary', async () => {
    const stream = {
      _id: 'stream_1',
      status: 'streaming',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
      operation: 'compact',
      attempt: 0,
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

    await _continue(ctx, { streamId: stream._id as never })

    expect(inserts).toHaveLength(0)
    expect(patches).toContainEqual({
      id: stream._id,
      patch: expect.objectContaining({ attempt: 0 }),
    })
  })

  test('interleaved newer message finalizes the turn and rolls over', async () => {
    const stream = {
      _id: 'stream_1',
      status: 'streaming',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
      operation: 'invoke',
      attempt: 0,
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

    await _continue(ctx, { streamId: stream._id as never })

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
      status: 'streaming',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
      operation: 'invoke',
      attempt: 0,
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

    await _continue(ctx, { streamId: stream._id as never })

    expect(inserts.some(({ table }) => table === 'messages')).toBe(false)
    expect(patches.some(({ id }) => id === 'message_1')).toBe(false)
  })

  // Approval/task parking moved to _suspendStep (see subagent-lifecycle.test.ts)
})

describe('_finalizeStopped', () => {
  test('preserves retry errors on the processing message when stopped', async () => {
    const stream = {
      _id: 'stream_1',
      status: 'stopping',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
      retryError: 'Provider 429: rate limit',
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
      status: 'stopping',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
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

  test('a stopped compaction stops claiming to be a summary', async () => {
    const stream = {
      _id: 'stream_1',
      status: 'stopping',
      sessionId: 'session_1',
      operation: 'compact',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
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
      status: 'stopping',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
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

describe('_fail', () => {
  /** The reaper settles a turn the same way a stop does. */
  test('settles a tool call the failed turn never answered', async () => {
    const stream = {
      _id: 'stream_1',
      status: 'streaming',
      sessionId: 'session_1',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
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
      status: 'streaming',
      sessionId: 'session_1',
      operation: 'compact',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
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
      status: 'streaming',
      sessionId: 'session_1',
      operation: 'invoke',
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
    }
    const { ctx, patches } = fakeCtx({
      docs: [
        stream,
        { _id: 'message_1', _creationTime: 10, selectedVersion: 1 },
      ],
      contents: [{ _id: 'content_1', version: 1, segmentIndex: 0, parts: [] }],
    })

    await _fail(ctx, {
      streamId: stream._id as never,
      message: 'Stream interrupted before completion.',
    })

    expect(
      patches.some(({ id, patch }) => id === 'message_1' && 'type' in patch),
    ).toBe(false)
  })
})

describe('pruneOrphanedOutputs', () => {
  test('reclaims orphaned blobs and skips referenced or in-flight rows', async () => {
    const now = Date.now()
    const old = now - 48 * 60 * 60 * 1000
    const rows = [
      // old, stream gone, message lost the ref -> orphan: delete blob + row
      {
        _id: 'r1',
        _creationTime: old,
        streamId: 's_gone',
        messageId: 'm_noref',
        storageId: 'blob_orphan',
      },
      // old, stream gone, message still references it -> keep blob, drop row
      {
        _id: 'r2',
        _creationTime: old,
        streamId: 's_gone',
        messageId: 'm_hasref',
        storageId: 'blob_valid',
      },
      // recent -> skipped entirely
      {
        _id: 'r3',
        _creationTime: now,
        streamId: 's_gone',
        messageId: 'm_noref',
        storageId: 'blob_recent',
      },
      // old but stream still running -> skipped (teardown will handle it)
      {
        _id: 'r4',
        _creationTime: old,
        streamId: 's_live',
        messageId: 'm_x',
        storageId: 'blob_live',
      },
    ]
    const liveStreams: Record<string, unknown> = { s_live: { _id: 's_live' } }
    const contentsByMessage: Record<string, Array<{ parts: unknown[] }>> = {
      m_noref: [{ parts: [{ type: 'text', text: 'hi' }] }],
      m_hasref: [{ parts: [{ type: 'tool-shell', outputRef: 'blob_valid' }] }],
    }
    const deletedRows: string[] = []
    const deletedBlobs: string[] = []
    const ctx = {
      db: {
        query: (table: string) => ({
          collect: async () => rows,
          withIndex: (_index: string, fn?: (q: unknown) => unknown) => {
            let messageId: string | undefined
            const q = {
              eq: (_field: string, value: string) => {
                messageId = value
                return q
              },
            }
            fn?.(q)
            return {
              collect: async () =>
                table === 'messageContents' && messageId
                  ? (contentsByMessage[messageId] ?? [])
                  : [],
            }
          },
        }),
        get: async (id: string) => liveStreams[id] ?? null,
        delete: async (id: string) => {
          deletedRows.push(id)
        },
      },
      storage: {
        delete: async (id: string) => {
          deletedBlobs.push(id)
        },
      },
    } as never

    await pruneOrphanedOutputs(ctx)

    expect(deletedBlobs).toEqual(['blob_orphan'])
    expect(deletedRows.sort()).toEqual(['r1', 'r2'])
  })
})
