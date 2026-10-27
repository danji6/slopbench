import { pruneOrphanedOutputs } from '@sb/convex/model/stream/lifecycle'
import { describe, expect, test } from 'bun:test'

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
