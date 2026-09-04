/// <reference types="bun-types" />
import {
  autoCompact,
  handleStreamEnd,
  runScheduledEvent,
  timeout,
} from '@sb/convex/model/chat/scheduling'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & {
  _id: string
  _creationTime: number
}
type InputRow = Record<string, unknown> & { _id: string }

function fakeCtx(initial: Record<string, InputRow[]>) {
  let clock = 100
  let nextId = 0
  const tables = new Map<string, Row[]>()
  const cancelledJobs: string[] = []
  const scheduled: Array<{ kind: 'after' | 'at'; args: unknown[] }> = []

  for (const [table, rows] of Object.entries(initial)) {
    tables.set(
      table,
      rows.map((row) => ({ ...row, _creationTime: clock++ })),
    )
  }

  const allRows = () => [...tables.values()].flat()
  const tableRows = (table: string) => tables.get(table) ?? []
  const indexConditions = () => {
    const conditions: Array<[string, unknown]> = []
    const q = {
      eq: (field: string, value: unknown) => {
        conditions.push([field, value])
        return q
      },
    }
    return { conditions, q }
  }

  const query = (table: string) => {
    let conditions: Array<[string, unknown]> = []
    const matching = () =>
      tableRows(table).filter((row) =>
        conditions.every(([field, value]) => row[field] === value),
      )
    const chain = {
      withIndex: (
        _index: string,
        callback: (q: ReturnType<typeof indexConditions>['q']) => unknown,
      ) => {
        const index = indexConditions()
        callback(index.q)
        conditions = index.conditions
        return chain
      },
      first: async () => matching()[0] ?? null,
      unique: async () => {
        const rows = matching()
        if (rows.length > 1) throw new Error('Expected a unique row')
        return rows[0] ?? null
      },
      collect: async () => matching(),
    }
    return chain
  }

  const rawCtx = {
    userId: 'user_1',
    db: {
      get: async (id: string) =>
        allRows().find((row) => row._id === id) ?? null,
      insert: async (table: string, fields: Record<string, unknown>) => {
        const row = {
          _id: `${table}_${++nextId}`,
          _creationTime: clock++,
          ...fields,
        }
        tables.set(table, [...tableRows(table), row])
        return row._id
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = allRows().find((candidate) => candidate._id === id)
        if (row) Object.assign(row, patch)
      },
      delete: async (id: string) => {
        for (const [table, rows] of tables) {
          tables.set(
            table,
            rows.filter((row) => row._id !== id),
          )
        }
      },
      query,
    },
    scheduler: {
      runAt: async (...args: unknown[]) => {
        scheduled.push({ kind: 'at', args })
        return `scheduled_${scheduled.length}`
      },
      runAfter: async (...args: unknown[]) => {
        scheduled.push({ kind: 'after', args })
        return `scheduled_${scheduled.length}`
      },
      cancel: async (jobId: string) => {
        cancelledJobs.push(jobId)
      },
    },
  }
  const ctx = rawCtx as never

  return {
    ctx,
    cancelledJobs,
    scheduled,
    rows: (table: string) => tableRows(table),
    remove: async (id: string) => rawCtx.db.delete(id),
  }
}

function baseRows(operation: 'invoke' | 'compact' = 'invoke') {
  return {
    sessions: [
      {
        _id: 'session_1',
        ownerId: 'user_1',
        activeAgentId: 'agent_1',
      },
    ],
    userSessions: [
      {
        _id: 'membership_1',
        sessionId: 'session_1',
        userId: 'user_1',
        role: 'owner',
      },
    ],
    agents: [{ _id: 'agent_1', ownerId: 'user_1', name: 'Agent' }],
    sessionAgents: [
      {
        _id: 'link_1',
        sessionId: 'session_1',
        agentId: 'agent_1',
        addedBy: 'user_1',
      },
    ],
    streams: [
      {
        _id: 'stream_1',
        sessionId: 'session_1',
        agentId: 'agent_1',
        invokedBy: 'user_1',
        operation,
        blocking: operation === 'compact',
        status: 'streaming',
        attempt: 0,
        leaseExpiresAt: Date.now() + 60_000,
      },
    ],
  }
}

describe('/timeout schedules', () => {
  test('replacement cancels the prior job and directly patches its chip', async () => {
    const state = fakeCtx(baseRows())

    await timeout(state.ctx, {
      sessionId: 'session_1' as never,
      duration: '1m',
    })
    const firstEvent = state.rows('scheduledEvents')[0]
    const firstChip = state.rows('messages')[0]

    await timeout(state.ctx, {
      sessionId: 'session_1' as never,
      duration: '30s',
    })

    expect(state.rows('scheduledEvents')).toHaveLength(1)
    expect(state.cancelledJobs).toEqual([firstEvent.jobId as string])
    expect(firstChip.extra).toEqual({
      name: 'timeout',
      argument: '1m',
      status: 'cancelled',
      reason: 'Replaced by a newer schedule',
    })
  })

  test('a due timeout requests a seam stop for a streaming turn', async () => {
    const state = fakeCtx(baseRows())
    await timeout(state.ctx, {
      sessionId: 'session_1' as never,
      duration: '0',
    })
    const event = state.rows('scheduledEvents')[0]

    await runScheduledEvent(state.ctx, { eventId: event._id as never })

    expect(state.rows('scheduledEvents')).toHaveLength(0)
    expect(state.rows('streams')[0].stopAt).toBeNumber()
    expect(state.rows('messages')[0].extra).toEqual({
      name: 'timeout',
      argument: '0',
      status: 'ran',
    })
  })

  test('turn completion cancels a timeout before it fires', async () => {
    const state = fakeCtx(baseRows('compact'))
    await timeout(state.ctx, {
      sessionId: 'session_1' as never,
      duration: '1h',
    })
    const stream = state.rows('streams')[0]

    await handleStreamEnd(state.ctx, stream as never, 'complete')

    expect(state.rows('scheduledEvents')).toHaveLength(0)
    expect(state.cancelledJobs).toHaveLength(1)
    expect(state.rows('messages')[0].extra).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        reason: 'Turn finished before timeout',
      }),
    )
  })
})

describe('/autoCompact schedules', () => {
  test('a manual stop re-arms it for the next invoke', async () => {
    const state = fakeCtx(baseRows())
    await autoCompact(state.ctx, { sessionId: 'session_1' as never })
    const event = state.rows('scheduledEvents')[0]
    const stream = state.rows('streams')[0]

    await handleStreamEnd(state.ctx, stream as never, 'stopped')

    expect(state.rows('scheduledEvents')).toHaveLength(1)
    expect(event.targetStreamId).toBeUndefined()
    expect(state.rows('messages')[0].extra).toEqual({
      name: 'autoCompact',
      status: 'queued',
    })
  })

  test('success reserves compaction at the source boundary before follow-up', async () => {
    const state = fakeCtx({
      ...baseRows(),
      messages: [
        {
          _id: 'source_message',
          sessionId: 'session_1',
          sender: { type: 'agent', id: 'agent_1' },
          role: 'assistant',
          status: 'done',
        },
      ],
    })
    await autoCompact(state.ctx, { sessionId: 'session_1' as never })
    const source = state.rows('streams')[0]
    source.processingMessageId = 'source_message'
    await state.remove(source._id)

    const scheduledCompact = await handleStreamEnd(
      state.ctx,
      source as never,
      'complete',
    )

    expect(scheduledCompact).toBe(true)
    expect(state.rows('scheduledEvents')).toHaveLength(0)
    expect(state.rows('messages').at(-1)?.extra).toEqual({
      name: 'autoCompact',
      status: 'ran',
    })
    expect(state.rows('streams')).toContainEqual(
      expect.objectContaining({
        operation: 'compact',
        contextBoundaryMessageId: 'source_message',
        preserveContextBoundary: true,
        followUpAfterCompact: true,
      }),
    )
  })

  test('fatal invoke failure compacts once without scheduling a follow-up', async () => {
    const state = fakeCtx({
      ...baseRows(),
      messages: [
        {
          _id: 'source_message',
          sessionId: 'session_1',
          sender: { type: 'agent', id: 'agent_1' },
          role: 'assistant',
          status: 'done',
        },
      ],
    })
    await autoCompact(state.ctx, { sessionId: 'session_1' as never })
    const source = state.rows('streams')[0]
    source.processingMessageId = 'source_message'
    await state.remove(source._id)

    await handleStreamEnd(state.ctx, source as never, 'failed')

    const compact = state.rows('streams')[0]
    expect(compact).toEqual(
      expect.objectContaining({
        operation: 'compact',
        followUpAfterCompact: false,
      }),
    )

    await state.remove(compact._id)
    await handleStreamEnd(state.ctx, compact as never, 'failed')

    expect(state.rows('scheduledEvents')).toHaveLength(0)
    expect(state.rows('streams')).toHaveLength(0)
  })

  test('a compaction reservation failure still suppresses source follow-up', async () => {
    const state = fakeCtx(baseRows())
    await autoCompact(state.ctx, { sessionId: 'session_1' as never })
    const source = state.rows('streams')[0]
    await state.remove(source._id)
    await state.remove('link_1')

    const handled = await handleStreamEnd(
      state.ctx,
      source as never,
      'complete',
    )

    expect(handled).toBe(true)
    expect(state.rows('scheduledEvents')).toHaveLength(0)
    expect(state.rows('messages')[0].extra).toEqual(
      expect.objectContaining({ status: 'failed' }),
    )
  })
})
