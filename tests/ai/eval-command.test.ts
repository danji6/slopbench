/// <reference types="bun-types" />
import { resetSessionCache } from '@sb/convex/model/chat/commands'
import { describe, expect, test } from 'bun:test'

function evalCtx(activeStream = false) {
  const session = { _id: 'session_1' }
  const deleted: string[] = []
  const inserted: Array<{ table: string; fields: Record<string, unknown> }> = []
  const q = { eq: () => q }

  const ctx = {
    userId: 'user_1',
    db: {
      get: async (id: string) => (id === session._id ? session : null),
      delete: async (id: string) => void deleted.push(id),
      insert: async (table: string, fields: Record<string, unknown>) => {
        inserted.push({ table, fields })
        return `${table}_1`
      },
      query: (table: string) => ({
        withIndex: (_index: string, cb: (query: typeof q) => typeof q) => {
          cb(q)
          if (table === 'userSessions') {
            return { unique: async () => ({ _id: 'membership_1' }) }
          }
          if (table === 'sessionState') return { unique: async () => null }
          if (table === 'streams') {
            return {
              first: async () =>
                activeStream
                  ? { _id: 'stream_1', leaseExpiresAt: Date.now() + 60_000 }
                  : null,
            }
          }
          if (table === 'sessionCache') {
            return { collect: async () => [{ _id: 'cache_1' }] }
          }
          throw new Error(`Unexpected query: ${table}`)
        },
      }),
    },
  } as never

  return { ctx, deleted, inserted }
}

describe('resetSessionCache', () => {
  test('invalidates the cache without inserting a command chip', async () => {
    const { ctx, deleted, inserted } = evalCtx()

    const result = await resetSessionCache(ctx, {
      sessionId: 'session_1' as never,
      requestId: 'request_1',
    })

    expect(result).toEqual({ queued: false })
    expect(deleted).toEqual(['cache_1'])
    expect(inserted).toEqual([])
  })

  test('queues its completion request without inserting a command chip', async () => {
    const { ctx, inserted } = evalCtx(true)

    const result = await resetSessionCache(ctx, {
      sessionId: 'session_1' as never,
      requestId: 'request_1',
    })

    expect(result).toEqual({ queued: true })
    expect(inserted).toEqual([
      {
        table: 'sessionState',
        fields: expect.objectContaining({
          commandQueue: [
            {
              name: 'eval',
              invokedBy: 'user_1',
              requestId: 'request_1',
            },
          ],
        }),
      },
    ])
  })
})
