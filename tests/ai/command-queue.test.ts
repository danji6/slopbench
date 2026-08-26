/// <reference types="bun-types" />
import {
  drainCommandQueue,
  isCommandQueued,
} from '@sb/convex/model/chat/commands'
import { describe, expect, test } from 'bun:test'

import { fakeSessionState } from '../setup/session-state'

type Doc = Record<string, unknown>
type Entry = {
  name: string
  invokedBy: string
  requestId?: string
  messageId?: string
}

const activeStream = () => ({
  _id: 'stream_1',
  leaseExpiresAt: Date.now() + 60_000,
})

function entry(name: string, messageId: string): Entry {
  return { name, invokedBy: 'user_1', messageId }
}

function drainCtx({
  queue,
  deletedChips = [],
  streams = [],
  activeAgentId = 'agent_1',
}: {
  queue: Entry[]
  deletedChips?: string[]
  /** One `getActiveStream` result per loop iteration, `null` when idle. */
  streams?: (ReturnType<typeof activeStream> | null)[]
  /** `null` stands for a session that lost its agent. */
  activeAgentId?: string | null
}) {
  const patches: Array<{ id: string; patch: Doc }> = []
  const state = fakeSessionState({ commandQueue: queue })
  const docs = new Map<string, Doc>([
    [
      'session_1',
      { _id: 'session_1', activeAgentId: activeAgentId ?? undefined },
    ],
  ])

  for (const item of queue) {
    if (!item.messageId) continue
    if (deletedChips.includes(item.messageId)) continue
    docs.set(item.messageId, {
      _id: item.messageId,
      extra: { name: item.name, status: 'queued' },
    })
  }

  let streamCall = 0
  const q = { eq: () => q, gt: () => q, lt: () => q }

  const ctx = {
    userId: 'user_1',
    db: {
      get: async (id: string) => docs.get(id) ?? null,
      patch: async (id: string, patch: Doc) => {
        if (state.owns(id)) return void state.patch(patch)
        patches.push({ id, patch })
        docs.set(id, { ...docs.get(id), ...patch })
      },
      insert: async (table: string, doc: Doc) => state.insert(doc),
      delete: async () => {},
      query: (table: string) => ({
        withIndex: (_index: string, cb: (query: typeof q) => typeof q) => {
          cb(q)
          if (table === 'sessionState') return state.query()
          if (table === 'userSessions') {
            return { unique: async () => ({ _id: 'membership_1' }) }
          }
          if (table === 'streams') {
            return { first: async () => streams[streamCall++] ?? null }
          }
          if (table === 'sessionCache') return { collect: async () => [] }
          throw new Error(`Unexpected query: ${table}`)
        },
      }),
    },
    scheduler: { runAfter: async () => 'job_1' },
  } as never

  return { ctx, patches, state }
}

const chipPatches = (patches: Array<{ id: string; patch: Doc }>) =>
  patches.filter(({ id }) => id.startsWith('msg_'))

const queuePatches = (state: { patches: Doc[] }) =>
  state.patches.map((patch) => patch.commandQueue)

describe('drainCommandQueue', () => {
  test('runs every waiting command in order and marks its chip', async () => {
    const first = entry('eval', 'msg_1')
    const second = entry('eval', 'msg_2')
    const { ctx, patches, state } = drainCtx({ queue: [first, second] })

    await drainCommandQueue(ctx, { sessionId: 'session_1' as never })

    expect(queuePatches(state)).toEqual([[second], []])
    expect(chipPatches(patches)).toEqual([
      { id: 'msg_1', patch: { extra: { name: 'eval', status: 'ran' } } },
      { id: 'msg_2', patch: { extra: { name: 'eval', status: 'ran' } } },
    ])
  })

  test('leaves the rest queued once the session is busy again', async () => {
    const first = entry('eval', 'msg_1')
    const second = entry('eval', 'msg_2')
    const { ctx, patches, state } = drainCtx({
      queue: [first, second],
      streams: [null, activeStream()],
    })

    await drainCommandQueue(ctx, { sessionId: 'session_1' as never })

    expect(queuePatches(state)).toEqual([[second]])
    expect(chipPatches(patches).map(({ id }) => id)).toEqual(['msg_1'])
  })

  test('drops a command whose chip the user deleted', async () => {
    const { ctx, patches, state } = drainCtx({
      queue: [entry('eval', 'msg_1')],
      deletedChips: ['msg_1'],
    })

    await drainCommandQueue(ctx, { sessionId: 'session_1' as never })

    expect(queuePatches(state)).toEqual([[]])
    expect(chipPatches(patches)).toEqual([])
  })

  test('runs a chipless command', async () => {
    const command: Entry = { name: 'eval', invokedBy: 'user_1' }
    const { ctx, patches, state } = drainCtx({ queue: [command] })

    await drainCommandQueue(ctx, { sessionId: 'session_1' as never })

    expect(queuePatches(state)).toEqual([[]])
    expect(chipPatches(patches)).toEqual([])
  })

  test('marks a failing command on its chip instead of retrying it', async () => {
    const { ctx, patches, state } = drainCtx({
      queue: [entry('compact', 'msg_1')],
      activeAgentId: null,
    })

    await drainCommandQueue(ctx, { sessionId: 'session_1' as never })

    expect(queuePatches(state)).toEqual([[]])
    expect(chipPatches(patches)).toEqual([
      {
        id: 'msg_1',
        patch: {
          extra: {
            name: 'compact',
            status: 'failed',
            error: 'No active agent',
          },
        },
      },
    ])
  })

  test('does nothing when the queue is empty', async () => {
    const { ctx, patches, state } = drainCtx({ queue: [] })

    await drainCommandQueue(ctx, { sessionId: 'session_1' as never })

    expect(patches).toEqual([])
    expect(state.patches).toEqual([])
  })
})

describe('isCommandQueued', () => {
  test('matches only a requested command owned by the caller', async () => {
    const own: Entry = {
      name: 'eval',
      invokedBy: 'user_1',
      requestId: 'request_1',
    }
    const other: Entry = {
      name: 'eval',
      invokedBy: 'user_2',
      requestId: 'request_2',
    }
    const { ctx } = drainCtx({ queue: [own, other] })

    const ownResult = await isCommandQueued(ctx, {
      sessionId: 'session_1' as never,
      requestId: 'request_1',
    })
    const otherResult = await isCommandQueued(ctx, {
      sessionId: 'session_1' as never,
      requestId: 'request_2',
    })
    const missingResult = await isCommandQueued(ctx, {
      sessionId: 'session_1' as never,
      requestId: 'missing',
    })

    expect(ownResult).toBe(true)
    expect(otherResult).toBe(false)
    expect(missingResult).toBe(false)
  })
})
