/// <reference types="bun-types" />
import { drainCommandQueue } from '@sb/convex/model/chat/commands'
import { describe, expect, test } from 'bun:test'

type Doc = Record<string, unknown>
type Entry = { name: string; invokedBy: string; messageId: string }

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
  const docs = new Map<string, Doc>([
    [
      'session_1',
      {
        _id: 'session_1',
        commandQueue: queue,
        activeAgentId: activeAgentId ?? undefined,
      },
    ],
  ])

  for (const item of queue) {
    if (deletedChips.includes(item.messageId)) continue
    docs.set(item.messageId, {
      _id: item.messageId,
      extra: { name: item.name, status: 'queued' },
    })
  }

  let streamCall = 0
  const q = { eq: () => q, gt: () => q, lt: () => q }

  const ctx = {
    db: {
      get: async (id: string) => docs.get(id) ?? null,
      patch: async (id: string, patch: Doc) => {
        patches.push({ id, patch })
        docs.set(id, { ...docs.get(id), ...patch })
      },
      delete: async () => {},
      query: (table: string) => ({
        withIndex: (_index: string, cb: (query: typeof q) => typeof q) => {
          cb(q)
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

  return { ctx, patches }
}

const chipPatches = (patches: Array<{ id: string; patch: Doc }>) =>
  patches.filter(({ id }) => id.startsWith('msg_'))

const queuePatches = (patches: Array<{ id: string; patch: Doc }>) =>
  patches
    .filter(({ id }) => id === 'session_1')
    .map(({ patch }) => patch.commandQueue)

describe('drainCommandQueue', () => {
  test('runs every waiting command in order and marks its chip', async () => {
    const first = entry('eval', 'msg_1')
    const second = entry('eval', 'msg_2')
    const { ctx, patches } = drainCtx({ queue: [first, second] })

    await drainCommandQueue(ctx, { sessionId: 'session_1' as never })

    expect(queuePatches(patches)).toEqual([[second], []])
    expect(chipPatches(patches)).toEqual([
      { id: 'msg_1', patch: { extra: { name: 'eval', status: 'ran' } } },
      { id: 'msg_2', patch: { extra: { name: 'eval', status: 'ran' } } },
    ])
  })

  test('leaves the rest queued once the session is busy again', async () => {
    const first = entry('eval', 'msg_1')
    const second = entry('eval', 'msg_2')
    const { ctx, patches } = drainCtx({
      queue: [first, second],
      streams: [null, activeStream()],
    })

    await drainCommandQueue(ctx, { sessionId: 'session_1' as never })

    expect(queuePatches(patches)).toEqual([[second]])
    expect(chipPatches(patches).map(({ id }) => id)).toEqual(['msg_1'])
  })

  test('drops a command whose chip the user deleted', async () => {
    const { ctx, patches } = drainCtx({
      queue: [entry('eval', 'msg_1')],
      deletedChips: ['msg_1'],
    })

    await drainCommandQueue(ctx, { sessionId: 'session_1' as never })

    expect(queuePatches(patches)).toEqual([[]])
    expect(chipPatches(patches)).toEqual([])
  })

  test('marks a failing command on its chip instead of retrying it', async () => {
    const { ctx, patches } = drainCtx({
      queue: [entry('compact', 'msg_1')],
      activeAgentId: null,
    })

    await drainCommandQueue(ctx, { sessionId: 'session_1' as never })

    expect(queuePatches(patches)).toEqual([[]])
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
    const { ctx, patches } = drainCtx({ queue: [] })

    await drainCommandQueue(ctx, { sessionId: 'session_1' as never })

    expect(patches).toEqual([])
  })
})
