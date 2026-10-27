/// <reference types="bun-types" />
import { deleteMessageParts, editMessagePart } from '@sb/convex/model/chat'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & { _id: string }

/** Fakes enough of the db for `requireMessageMutation` + segment writes. */
function mutationCtx({ message, segments }: { message: Row; segments: Row[] }) {
  const session = { _id: message.sessionId, ownerId: 'user_1', settings: {} }
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const deletes: string[] = []
  const rows = [...segments]
  const byId = new Map<string, Row>([
    [message._id, message],
    [session._id as string, session as never],
    ...rows.map((row) => [row._id, row] as const),
  ])

  const ctx = {
    userId: 'user_1',
    role: 'user',
    db: {
      get: async (id: string) => byId.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch })
        const doc = byId.get(id)
        if (doc) Object.assign(doc, patch)
      },
      delete: async (id: string) => {
        deletes.push(id)
        byId.delete(id)
        const index = rows.findIndex((row) => row._id === id)
        if (index >= 0) rows.splice(index, 1)
      },
      query: (table: string) => {
        const captured: Record<string, unknown> = {}
        const q = {
          eq: (field: string, value: unknown) => {
            captured[field] = value
            return q
          },
        }
        const chain = {
          withIndex: (_index: string, fn?: (query: typeof q) => typeof q) => {
            fn?.(q)
            return chain
          },
          order: () => chain,
          first: async () => null, // no active stream
          unique: async () => {
            if (table === 'userSessions') {
              return { _id: 'member_1', role: 'owner' }
            }
            if (table === 'messageContents') {
              return (
                rows.find(
                  (row) =>
                    row.messageId === captured.messageId &&
                    row.version === captured.version &&
                    row.segmentIndex === captured.segmentIndex,
                ) ?? null
              )
            }
            return null
          },
          collect: async () => {
            if (table === 'messageContents') {
              return rows.filter(
                (row) =>
                  row.messageId === captured.messageId &&
                  (captured.version === undefined ||
                    row.version === captured.version),
              )
            }
            return []
          },
        }
        return chain
      },
    },
    scheduler: { runAfter: async () => 'job_1' },
    storage: { delete: async () => {} },
  } as never

  return { ctx, patches, deletes, rows }
}

const text = (value: string) => ({ type: 'text', text: value })

function fixture() {
  const message: Row = {
    _id: 'm_1',
    sessionId: 'session_1',
    status: 'done',
    role: 'assistant',
    sender: { type: 'agent', id: 'agent_1' },
    selectedVersion: 1,
    versionCount: 1,
  }
  const segments: Row[] = [
    {
      _id: 'c_0',
      messageId: 'm_1',
      version: 1,
      segmentIndex: 0,
      parts: [text('a0'), text('a1')],
    },
    {
      _id: 'c_1',
      messageId: 'm_1',
      version: 1,
      segmentIndex: 1,
      parts: [text('b0'), text('b1')],
    },
  ]
  return { message, segments }
}

describe('deleteMessageParts', () => {
  test('removes addressed parts within their segments', async () => {
    const { ctx, rows } = mutationCtx(fixture())

    const deleted = await deleteMessageParts(ctx, {
      messageId: 'm_1' as never,
      addresses: [
        { segmentIndex: 0, partIndex: 1 },
        { segmentIndex: 1, partIndex: 0 },
      ],
    })

    expect(deleted).toBe(false)
    expect(rows.map((row) => row.parts)).toEqual([[text('a0')], [text('b1')]])
  })

  test('expands `from` across all later parts and segments', async () => {
    const { ctx, rows, deletes } = mutationCtx(fixture())

    const deleted = await deleteMessageParts(ctx, {
      messageId: 'm_1' as never,
      addresses: [],
      from: { segmentIndex: 0, partIndex: 1 },
    })

    expect(deleted).toBe(false)
    // Segment 1 emptied entirely and its row is dropped (no renumbering)
    expect(deletes).toContain('c_1')
    expect(rows.map((row) => row._id)).toEqual(['c_0'])
    expect(rows[0].parts).toEqual([text('a0')])
  })

  test('deletes the whole message when nothing remains', async () => {
    const { ctx, deletes } = mutationCtx(fixture())

    const deleted = await deleteMessageParts(ctx, {
      messageId: 'm_1' as never,
      addresses: [],
      from: { segmentIndex: 0, partIndex: 0 },
    })

    expect(deleted).toBe(true)
    expect(deletes).toContain('m_1')
  })
})

describe('editMessagePart', () => {
  test('edits a part in a later segment without touching others', async () => {
    const { ctx, rows } = mutationCtx(fixture())

    await editMessagePart(ctx, {
      messageId: 'm_1' as never,
      segmentIndex: 1,
      partIndex: 1,
      text: 'edited',
    })

    expect(rows[0].parts).toEqual([text('a0'), text('a1')])
    expect(rows[1].parts).toEqual([text('b0'), text('edited')])
  })

  test('rejects an address pointing at a missing segment', async () => {
    const { ctx } = mutationCtx(fixture())

    expect(
      editMessagePart(ctx, {
        messageId: 'm_1' as never,
        segmentIndex: 5,
        partIndex: 0,
        text: 'nope',
      }),
    ).rejects.toThrow()
  })
})
