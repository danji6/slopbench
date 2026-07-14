/// <reference types="bun-types" />
import { cleanUpGeneratedAttachments } from '@sb/convex/model/attachments'
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
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const ctx = {
    db: {
      query: (table: string) => ({
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
          return { collect: async () => rows }
        },
      }),
      get: async (id: string) => messages[id] ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch })
      },
      delete: async (id: string) => {
        dbDeletes.push(id)
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
    expect(dbDeletes).toEqual(['att2'])
  })
})
