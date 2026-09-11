/// <reference types="bun-types" />
import {
  _createGenerated,
  cleanUpGeneratedAttachments,
  createReference,
  removeAttachment,
  unreferencedAttachmentIds,
} from '@sb/convex/model/attachments'
import {
  generatedFileCacheKey,
  generatedFilename,
  isGeneratedFilePart,
  parseDataUrl,
} from '@sb/convex/model/stream/generatedFiles'
import { describe, expect, test } from 'bun:test'

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('isGeneratedFilePart', () => {
  test('matches inline data-url file parts', () => {
    expect(isGeneratedFilePart({ type: 'file', url: PNG_DATA_URL })).toBe(true)
  })

  test('ignores already-offloaded attachment references', () => {
    expect(
      isGeneratedFilePart({ type: 'file', url: 'attachment:abc123' }),
    ).toBe(false)
  })

  test('ignores external urls and non-file parts', () => {
    expect(isGeneratedFilePart({ type: 'file', url: 'https://x/y.png' })).toBe(
      false,
    )
    expect(isGeneratedFilePart({ type: 'text', text: 'hi' })).toBe(false)
  })
})

describe('parseDataUrl', () => {
  test('decodes a base64 image into bytes with its media type', () => {
    const parsed = parseDataUrl(PNG_DATA_URL)
    expect(parsed?.mediaType).toBe('image/png')
    expect(parsed?.bytes.length).toBeGreaterThan(0)
    // PNG magic number
    expect(Array.from(parsed!.bytes.slice(0, 4))).toEqual([137, 80, 78, 71])
  })

  test('returns null for non data urls', () => {
    expect(parseDataUrl('attachment:abc')).toBeNull()
  })
})

describe('generatedFileCacheKey', () => {
  test('is stable for identical urls and differs across urls', () => {
    expect(generatedFileCacheKey(PNG_DATA_URL)).toBe(
      generatedFileCacheKey(PNG_DATA_URL),
    )
    expect(generatedFileCacheKey(PNG_DATA_URL)).not.toBe(
      generatedFileCacheKey('data:image/jpeg;base64,/9j/4AAQ'),
    )
  })
})

describe('generatedFilename', () => {
  test('derives an extension from the media type', () => {
    expect(generatedFilename('image/png', 0)).toBe('generated-1.png')
    expect(generatedFilename('image/svg+xml', 1)).toBe('generated-2.svg')
    expect(generatedFilename('application/octet-stream;x=1', 0)).toBe(
      'generated-1.octet-stream',
    )
  })
})

function reconcileCtx(
  rows: Array<Record<string, unknown>>,
  messages: Record<string, { parts: unknown[] }>,
) {
  const storageDeletes: string[] = []
  const dbDeletes: string[] = []
  const deleted = new Set<string>()
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const files = new Map(
    rows.map((row) => [
      row.fileId as string,
      {
        _id: row.fileId,
        storageId: row.storageId,
        previewStorageId: row.previewStorageId,
      },
    ]),
  )
  const ctx = {
    db: {
      query: (table: string) => ({
        collect: async () => rows,
        withIndex: (_index: string, fn?: (q: unknown) => unknown) => {
          if (table === 'messageContents') {
            let messageId: string | undefined
            const q = {
              eq: (_field: string, value: string) => {
                messageId = value
                return q
              },
            }
            fn?.(q)
            const parts = messageId ? (messages[messageId]?.parts ?? []) : []
            return { collect: async () => [{ parts }] }
          }
          let field: string | undefined
          let value: string | undefined
          const q = {
            eq: (nextField: string, nextValue: string) => {
              field = nextField
              value = nextValue
              return q
            },
          }
          fn?.(q)
          const matches = () =>
            rows.filter(
              (row) =>
                !deleted.has(row._id as string) &&
                (!field || row[field] === value),
            )
          return {
            collect: async () => matches(),
            first: async () => matches()[0] ?? null,
          }
        },
      }),
      get: async (id: string) => messages[id] ?? files.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch })
      },
      delete: async (id: string) => {
        dbDeletes.push(id)
        deleted.add(id)
      },
    },
    storage: {
      delete: async (id: string) => {
        storageDeletes.push(id)
      },
    },
  }
  return { ctx, storageDeletes, dbDeletes, patches }
}

describe('cleanUpGeneratedAttachments', () => {
  test('keeps referenced attachments and clears their streamId', async () => {
    const rows = [
      {
        _id: 'att1',
        fileId: 'file1',
        storageId: 'blob1',
        messageId: 'msg1',
        streamId: 'stream1',
      },
    ]
    const messages = {
      msg1: {
        parts: [{ type: 'file', url: 'attachment:att1', attachmentId: 'att1' }],
      },
    }
    const { ctx, storageDeletes, dbDeletes, patches } = reconcileCtx(
      rows,
      messages,
    )

    await cleanUpGeneratedAttachments(ctx as never, 'stream1' as never)

    expect(patches).toEqual([{ id: 'att1', patch: { streamId: undefined } }])
    expect(storageDeletes).toEqual([])
    expect(dbDeletes).toEqual([])
  })

  test('deletes attachments not referenced by the final message', async () => {
    const rows = [
      {
        _id: 'att2',
        fileId: 'file2',
        storageId: 'blob2',
        messageId: 'msg1',
        streamId: 'stream1',
      },
    ]
    const messages = { msg1: { parts: [{ type: 'text', text: 'no image' }] } }
    const { ctx, storageDeletes, dbDeletes, patches } = reconcileCtx(
      rows,
      messages,
    )

    await cleanUpGeneratedAttachments(ctx as never, 'stream1' as never)

    expect(patches).toEqual([])
    expect(storageDeletes).toEqual(['blob2'])
    expect(dbDeletes).toEqual(['att2', 'file2'])
  })
})

describe('shared attachment lifecycle', () => {
  test('records authoritative storage size for generated files', async () => {
    const inserts: Array<{ table: string; value: Record<string, unknown> }> = []
    const ctx = {
      db: {
        system: {
          get: async (_table: string, id: string) =>
            id === 'blob1' ? { size: 42, contentType: 'image/png' } : null,
        },
        insert: async (table: string, value: Record<string, unknown>) => {
          inserts.push({ table, value })
          return table === 'attachmentFiles' ? 'file1' : 'attachment1'
        },
      },
    }

    await _createGenerated(ctx as never, {
      streamId: 'stream1' as never,
      messageId: 'message1' as never,
      sessionId: 'session1' as never,
      uploaderId: 'user1' as never,
      storageId: 'blob1' as never,
      filename: 'image.png',
      mediaType: 'image/png',
    })

    expect(inserts[0]?.table).toBe('attachmentFiles')
    expect(inserts[0]?.value.byteLength).toBe(42)
    expect(inserts[1]).toEqual({
      table: 'attachments',
      value: {
        streamId: 'stream1',
        messageId: 'message1',
        sessionId: 'session1',
        uploaderId: 'user1',
        storageId: 'blob1',
        filename: 'image.png',
        mediaType: 'image/png',
        fileId: 'file1',
      },
    })
  })

  test('retains files referenced by an older message version', () => {
    const file = { type: 'file', attachmentId: 'attachment1' }
    expect(unreferencedAttachmentIds([file], [file])).toEqual(new Set())
    expect(unreferencedAttachmentIds([file], [])).toEqual(
      new Set(['attachment1']),
    )
  })

  test('creates a session-local reference from a permanent token', async () => {
    const file = {
      _id: 'file1',
      storageId: 'blob1',
      previewStorageId: 'preview1',
      filename: 'notes.txt',
      mediaType: 'text/plain',
      byteLength: 10,
      shareToken: 'token1',
    }
    let inserted: Record<string, unknown> | undefined
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({ unique: async () => file }),
        }),
        insert: async (_table: string, value: Record<string, unknown>) => {
          inserted = value
          return 'attachment2'
        },
        get: async () => ({ _id: 'attachment2', ...inserted }),
      },
    }

    const reference = await createReference(ctx as never, {
      token: 'token1',
      sessionId: 'session2' as never,
      uploaderId: 'user1' as never,
    })

    expect(inserted).toEqual({
      fileId: 'file1',
      storageId: 'blob1',
      previewStorageId: 'preview1',
      uploaderId: 'user1',
      sessionId: 'session2',
      filename: 'notes.txt',
      mediaType: 'text/plain',
    })
    expect(reference._id).toBe('attachment2' as never)
  })

  test('keeps shared blobs until the final reference is removed', async () => {
    const attachments = new Map([
      ['attachment1', { _id: 'attachment1', fileId: 'file1' }],
      ['attachment2', { _id: 'attachment2', fileId: 'file1' }],
    ])
    const file = {
      _id: 'file1',
      storageId: 'blob1',
      previewStorageId: 'preview1',
    }
    const storageDeletes: string[] = []
    const dbDeletes: string[] = []
    const ctx = {
      db: {
        delete: async (id: string) => {
          dbDeletes.push(id)
          attachments.delete(id)
        },
        get: async (id: string) => (id === 'file1' ? file : null),
        query: () => ({
          withIndex: () => ({
            first: async () =>
              [...attachments.values()].find(
                (attachment) => attachment.fileId === 'file1',
              ) ?? null,
          }),
        }),
      },
      storage: {
        delete: async (id: string) => {
          storageDeletes.push(id)
        },
      },
    }
    const attachment = (id: string) => ({
      _id: id,
      fileId: 'file1',
      sessionId: 'session1',
      storageId: 'blob1',
    })

    await removeAttachment(ctx as never, attachment('attachment1') as never)
    expect(storageDeletes).toEqual([])
    expect(dbDeletes).toEqual(['attachment1'])

    await removeAttachment(ctx as never, attachment('attachment2') as never)
    expect(storageDeletes).toEqual(['blob1', 'preview1'])
    expect(dbDeletes).toEqual(['attachment1', 'attachment2', 'file1'])
  })
})
