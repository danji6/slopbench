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
    appearances: [],
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

const LOOK_A = 'appearances_source_1'
const LOOK_B = 'appearances_source_2'

function message(
  appearanceKey?: string,
): SessionArchive['session']['messages'][number] {
  return {
    role: 'assistant',
    parts: [{ type: 'text', text: 'hi' }],
    senderSnapshot: { name: 'Ada', appearanceKey },
  }
}

function archive(
  messages: SessionArchive['session']['messages'],
  appearances: SessionArchive['appearances'],
): SessionArchive {
  return {
    version: 1,
    exportedAt: 0,
    appearances,
    session: { title: 'Imported', messages },
  }
}

describe('session archive appearances', () => {
  test('a look shared by several messages is stored and interned once', async () => {
    const { ctx, tables } = makeCtx()

    await importOne(ctx, {
      subject: 'sub_1',
      avatars: {},
      payload: archive([message(LOOK_A), message(LOOK_A), message(LOOK_A)], {
        [LOOK_A]: { css: '.a {}' },
      }),
    })

    expect(tables.appearances).toHaveLength(1)
    expect(tables.appearances[0].css).toBe('.a {}')

    const ids = tables.messages.map((row) => row.appearanceId)
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toBe(tables.appearances[0]._id)
  })

  test('distinct looks keep their own rows', async () => {
    const { ctx, tables } = makeCtx()

    await importOne(ctx, {
      subject: 'sub_1',
      avatars: {},
      payload: archive([message(LOOK_A), message(LOOK_B)], {
        [LOOK_A]: { css: '.a {}' },
        [LOOK_B]: { css: '.b {}' },
      }),
    })

    expect(tables.appearances).toHaveLength(2)
    expect(tables.messages[0].appearanceId).not.toBe(
      tables.messages[1].appearanceId,
    )
  })

  test('two archived keys with the same look collapse into one row', async () => {
    const { ctx, tables } = makeCtx()

    await importOne(ctx, {
      subject: 'sub_1',
      avatars: {},
      payload: archive([message(LOOK_A), message(LOOK_B)], {
        [LOOK_A]: { css: '.same {}' },
        [LOOK_B]: { css: '.same {}' },
      }),
    })

    expect(tables.appearances).toHaveLength(1)
    expect(tables.messages[0].appearanceId).toBe(
      tables.messages[1].appearanceId,
    )
  })

  test('a message referencing a missing look imports without one', async () => {
    const { ctx, tables } = makeCtx()

    await importOne(ctx, {
      subject: 'sub_1',
      avatars: {},
      payload: archive([message(LOOK_A), message()], {}),
    })

    expect(tables.appearances).toEqual([])
    expect(tables.messages[0].appearanceId).toBeUndefined()
    expect(tables.messages[0].senderName).toBe('Ada')
  })
})
