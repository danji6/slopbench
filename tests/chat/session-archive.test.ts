/// <reference types="bun-types" />
import { importOne } from '@sb/convex/model/session/archive'
import type { SessionArchive } from '@sb/convex/model/session/archive'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & { _id: string }

/** A multi-table stub. Every read here goes through an equality index. */
function makeCtx() {
  const tables: Record<string, Row[]> = {
    users: [{ _id: 'users_1', subject: 'sub_1' }],
    sessions: [],
    userSessions: [],
    messages: [],
    messageContents: [],
    avatars: [],
  }
  let nextId = 1

  const ctx = {
    db: {
      get: async (id: string) =>
        Object.values(tables)
          .flat()
          .find((row) => row._id === id) ?? null,
      insert: async (table: string, doc: Record<string, unknown>) => {
        const _id = `${table}_${nextId++}`
        tables[table].push({ _id, ...doc })
        return _id
      },
      patch: async () => {},
      query: (table: string) => ({
        withIndex: (_index: string, build?: (q: unknown) => unknown) => {
          const captured: Record<string, unknown> = {}
          const q = {
            eq: (field: string, value: unknown) => {
              captured[field] = value
              return q
            },
          }
          build?.(q)

          const matches = tables[table].filter((row) =>
            Object.entries(captured).every(
              ([key, value]) => row[key] === value,
            ),
          )

          return {
            order: () => ({ collect: async () => matches }),
            collect: async () => matches,
            unique: async () => matches[0] ?? null,
            first: async () => matches[0] ?? null,
          }
        },
      }),
    },
  } as never

  return { ctx, tables }
}

function message(): SessionArchive['session']['messages'][number] {
  return {
    role: 'assistant',
    parts: [{ type: 'text', text: 'hi' }],
    senderSnapshot: { name: 'Ada', avatarKey: 'ada' },
  }
}

function archive(
  messages: SessionArchive['session']['messages'],
): SessionArchive {
  return {
    version: 1,
    exportedAt: 0,
    session: { title: 'Imported', messages },
  }
}

describe('session archive import', () => {
  test('preserves sender identity and content', async () => {
    const { ctx, tables } = makeCtx()
    await importOne(ctx, {
      subject: 'sub_1',
      avatars: { ada: 'storage_1' as never },
      payload: archive([message()]),
    })
    expect(tables.messages).toHaveLength(1)
    expect(tables.messages[0].senderName).toBe('Ada')
    expect(tables.messages[0].senderAvatarId).toBe(tables.avatars[0]._id)
    expect(tables.avatars[0].storageId).toBe('storage_1')
    expect(tables.messageContents[0].parts).toEqual([
      { type: 'text', text: 'hi' },
    ])
  })

  test('imports messages without sender snapshots or avatar data', async () => {
    const { ctx, tables } = makeCtx()
    await importOne(ctx, {
      subject: 'sub_1',
      avatars: {},
      payload: archive([
        message(),
        { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ]),
    })
    expect(tables.messages).toHaveLength(2)
    expect(tables.avatars).toEqual([])
    expect(tables.messages[0].senderName).toBe('Ada')
    expect(tables.messages[0].senderAvatarId).toBeUndefined()
    expect(tables.messages[1].senderName).toBeUndefined()
    expect(tables.messages[1].role).toBe('user')
  })
})
