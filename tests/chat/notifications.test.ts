/// <reference types="bun-types" />
import {
  clearRead,
  discardSession,
  list,
  markAllRead,
  markRead,
  markSessionRead,
  notificationPreview,
  notificationPreviewFromParts,
  notifyAgentEvent,
  notifyUserMessage,
} from '@sb/convex/model/notifications'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & {
  _id: string
  _creationTime: number
}

function fakeCtx(initial: Record<string, Row[]> = {}) {
  const tables = new Map(
    Object.entries(initial).map(([name, rows]) => [
      name,
      rows.map((row) => ({ ...row })),
    ]),
  )
  let sequence = 10_000

  const query = (table: string) => {
    const matches: Record<string, unknown> = {}
    let descending = false
    const chain = {
      withIndex: (_name: string, build?: (q: unknown) => unknown) => {
        const builder = {
          eq: (field: string, value: unknown) => {
            matches[field] = value
            return builder
          },
        }
        build?.(builder)
        return chain
      },
      order: (direction: string) => {
        descending = direction === 'desc'
        return chain
      },
      collect: async () => selected(),
      take: async (count: number) => selected().slice(0, count),
    }

    const selected = () => {
      const rows = (tables.get(table) ?? []).filter((row) =>
        Object.entries(matches).every(([field, value]) => row[field] === value),
      )
      if (!descending) return rows
      return [...rows].sort(
        (a, b) =>
          Number(b.readAt ?? b._creationTime) -
            Number(a.readAt ?? a._creationTime) ||
          b._creationTime - a._creationTime,
      )
    }
    return chain
  }

  const ctx = {
    userId: 'user_1',
    db: {
      get: async (id: string) =>
        [...tables.values()].flat().find((row) => row._id === id) ?? null,
      query,
      insert: async (table: string, fields: Record<string, unknown>) => {
        const row = {
          _id: `${table}_${sequence}`,
          _creationTime: sequence++,
          ...fields,
        }
        const rows = tables.get(table) ?? []
        rows.push(row)
        tables.set(table, rows)
        return row._id
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = [...tables.values()].flat().find((item) => item._id === id)
        if (row) Object.assign(row, patch)
      },
      delete: async (id: string) => {
        for (const [name, rows] of tables) {
          tables.set(
            name,
            rows.filter((row) => row._id !== id),
          )
        }
      },
    },
  } as never

  return {
    ctx,
    rows: (table: string) => tables.get(table) ?? [],
  }
}

const session = {
  _id: 'session_1',
  _creationTime: 1,
  ownerId: 'user_1',
  title: 'Notifications',
}

const memberships = [
  {
    _id: 'membership_1',
    _creationTime: 2,
    sessionId: 'session_1',
    userId: 'user_1',
    role: 'owner',
  },
  {
    _id: 'membership_2',
    _creationTime: 3,
    sessionId: 'session_1',
    userId: 'user_2',
    role: 'member',
  },
]

describe('notification previews', () => {
  test('collapse whitespace and cap previews', () => {
    expect(notificationPreview('  hello\n   world  ', 'fallback')).toBe(
      'hello world',
    )
    expect(notificationPreview('x'.repeat(200), 'fallback')).toHaveLength(140)
  })

  test('reads only text parts and uses a textless fallback', () => {
    expect(
      notificationPreviewFromParts([
        { type: 'reasoning', text: 'secret' },
        { type: 'text', text: 'final\nanswer' },
      ]),
    ).toBe('final answer')
    expect(notificationPreviewFromParts([{ type: 'tool-shell' }])).toBe(
      'Turn completed',
    )
  })
})

describe('notification fan-out', () => {
  test('a user message reaches every member except its sender', async () => {
    const { ctx, rows } = fakeCtx({
      sessions: [session],
      userSessions: memberships,
    })

    await notifyUserMessage(ctx, {
      sessionId: 'session_1' as never,
      senderId: 'user_1' as never,
      actorName: 'Ada',
      preview: 'hello',
      sourceMessageId: 'message_1' as never,
    })

    expect(rows('notifications')).toEqual([
      expect.objectContaining({
        recipientId: 'user_2',
        kind: 'user_message',
        status: 'unread',
        sessionTitle: 'Notifications',
        preview: 'hello',
      }),
    ])
  })

  test('agent events reach all members but hidden child events are ignored', async () => {
    const agent = {
      _id: 'agent_1',
      _creationTime: 4,
      ownerId: 'user_1',
      name: 'Helper',
    }
    const { ctx, rows } = fakeCtx({
      sessions: [session],
      agents: [agent],
      userSessions: memberships,
    })

    await notifyAgentEvent(ctx, {
      sessionId: 'session_1' as never,
      agentId: 'agent_1' as never,
      kind: 'approval_required',
    })
    expect(rows('notifications').map((row) => row.recipientId)).toEqual([
      'user_1',
      'user_2',
    ])

    const child = {
      ...session,
      _id: 'session_child',
      parent: { sessionId: 'session_1' },
    }
    rows('sessions').push(child)
    await notifyAgentEvent(ctx, {
      sessionId: 'session_child' as never,
      agentId: 'agent_1' as never,
      kind: 'turn_completed',
    })
    expect(rows('notifications')).toHaveLength(2)
  })

  test('unread fan-out prunes older rows to 100', async () => {
    const notifications = Array.from({ length: 100 }, (_, index) => ({
      _id: `notification_${index}`,
      _creationTime: 100 + index,
      recipientId: 'user_2',
      sessionId: 'session_1',
      kind: 'user_message',
      status: 'unread',
      sessionTitle: 'Notifications',
      actorName: 'Ada',
    }))
    const { ctx, rows } = fakeCtx({
      sessions: [session],
      userSessions: memberships,
      notifications,
    })

    await notifyUserMessage(ctx, {
      sessionId: 'session_1' as never,
      senderId: 'user_1' as never,
      actorName: 'Ada',
      preview: 'newest',
      sourceMessageId: 'message_1' as never,
    })

    expect(rows('notifications')).toHaveLength(100)
    expect(rows('notifications').some((row) => row.preview === 'newest')).toBe(
      true,
    )
  })
})

describe('notification read lifecycle', () => {
  test('marking all read keeps only the 50 newest read rows', async () => {
    const notifications = Array.from({ length: 55 }, (_, index) => ({
      _id: `notification_${index}`,
      _creationTime: 100 + index,
      recipientId: 'user_1',
      sessionId: 'session_1',
      kind: 'user_message',
      status: 'unread',
      sessionTitle: 'Notifications',
      actorName: 'Ada',
    }))
    const { ctx, rows } = fakeCtx({ notifications })

    await markAllRead(ctx)

    expect(rows('notifications')).toHaveLength(50)
    expect(rows('notifications').every((row) => row.status === 'read')).toBe(
      true,
    )
    expect(
      rows('notifications').some((row) => row._id === 'notification_0'),
    ).toBe(false)
  })

  test('single, session, discard, list, and clear operations stay scoped', async () => {
    const notifications = [
      {
        _id: 'notification_1',
        _creationTime: 1,
        recipientId: 'user_1',
        sessionId: 'session_1',
        kind: 'user_message',
        status: 'unread',
        sessionTitle: 'One',
        actorName: 'Ada',
      },
      {
        _id: 'notification_2',
        _creationTime: 2,
        recipientId: 'user_1',
        sessionId: 'session_2',
        kind: 'turn_completed',
        status: 'unread',
        sessionTitle: 'Two',
        actorName: 'Bot',
      },
      {
        _id: 'notification_other',
        _creationTime: 3,
        recipientId: 'user_2',
        sessionId: 'session_1',
        kind: 'user_message',
        status: 'unread',
        sessionTitle: 'One',
        actorName: 'Other',
      },
    ]
    const { ctx, rows } = fakeCtx({ notifications })

    await markRead(ctx, { notificationId: 'notification_1' as never })
    await markSessionRead(ctx, { sessionId: 'session_2' as never })
    expect(await list(ctx, { status: 'read' })).toHaveLength(2)

    await discardSession(ctx, { sessionId: 'session_1' as never })
    expect(
      rows('notifications').some((row) => row._id === 'notification_other'),
    ).toBe(true)

    await clearRead(ctx)
    expect(rows('notifications')).toEqual([
      expect.objectContaining({ _id: 'notification_other' }),
    ])
  })
})
