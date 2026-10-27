import { buildProviderHistory } from '@sb/convex/actions/stream/history'
import { describe, expect, test } from 'bun:test'
import {
  attachmentHistoryCtx,
  attachmentMessage,
  firstContentPart,
  providerData,
} from '~/tests/helpers/provider-history'

describe('provider attachment history', () => {
  test('describes text attachments without reading their contents', async () => {
    const message = attachmentMessage('att_text', 'text/plain', 'notes.txt')
    const ctx = attachmentHistoryCtx({
      message,
      attachment: {
        storageId: 'blob_text',
        mediaType: 'text/plain',
        filename: 'notes.txt',
        shareToken: 'share-text',
        byteLength: 11,
      },
      blobs: { blob_text: new Blob(['hello\nworld']) },
    })

    const history = await buildProviderHistory(ctx, providerData(), [])

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              '<attachment reference="attachment:share-text/notes.txt" filename="notes.txt" mediaType="text/plain" bytes="11">\n' +
              'Use read_attachment with this reference to read the file in bounded ranges.\n' +
              '</attachment>',
          },
        ],
      },
    ])
  })

  for (const mediaType of ['', 'application/octet-stream']) {
    test(`embeds text-looking attachments with ${mediaType || 'empty'} media type`, async () => {
      const message = attachmentMessage('att_md', mediaType, 'README.md')
      const ctx = attachmentHistoryCtx({
        message,
        attachment: {
          storageId: 'blob_md',
          mediaType,
          filename: 'README.md',
          shareToken: 'share-md',
          byteLength: 9,
        },
        blobs: { blob_md: new Blob(['# Project']) },
      })

      const history = await buildProviderHistory(ctx, providerData(), [])

      expect(history).toEqual([
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `<attachment reference="attachment:share-md/README.md" filename="README.md" mediaType="${mediaType}" bytes="9">\n` +
                'Use read_attachment with this reference to read the file in bounded ranges.\n' +
                '</attachment>',
            },
          ],
        },
      ])
    })
  }

  test('keeps image attachments as file data urls', async () => {
    const message = attachmentMessage('att_png', 'image/png', 'pixel.png')
    const ctx = attachmentHistoryCtx({
      message,
      attachment: {
        storageId: 'blob_png',
        previewStorageId: 'blob_preview',
        previewMediaType: 'image/jpeg',
        mediaType: 'image/png',
        filename: 'pixel.png',
      },
      blobs: {
        blob_png: new Blob([new Uint8Array([9, 9, 9])]),
        blob_preview: new Blob([new Uint8Array([1, 2, 3])]),
      },
    })

    const history = await buildProviderHistory(
      ctx,
      providerData(message._id),
      [],
    )

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'image/jpeg',
            filename: 'pixel.png',
            data: { type: 'url', url: new URL('data:image/jpeg;base64,AQID') },
          },
        ],
      },
    ])
  })

  test('keeps binary attachments as file data urls', async () => {
    const message = attachmentMessage('att_pdf', 'application/pdf', 'doc.pdf')
    const ctx = attachmentHistoryCtx({
      message,
      attachment: {
        storageId: 'blob_pdf',
        mediaType: 'application/pdf',
        filename: 'doc.pdf',
      },
      blobs: { blob_pdf: new Blob([new Uint8Array([37, 80, 68, 70])]) },
    })

    const history = await buildProviderHistory(
      ctx,
      providerData(message._id),
      [],
    )

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'application/pdf',
            filename: 'doc.pdf',
            data: {
              type: 'url',
              url: new URL('data:application/pdf;base64,JVBERg=='),
            },
          },
        ],
      },
    ])
  })

  test('escapes attachment filenames in file block paths', async () => {
    const filename = 'bad"\n<name>.txt'
    const message = attachmentMessage('att_escape', 'text/plain', filename)
    const ctx = attachmentHistoryCtx({
      message,
      attachment: {
        storageId: 'blob_escape',
        mediaType: 'text/plain',
        filename,
        shareToken: 'share-escape',
        byteLength: 7,
      },
      blobs: { blob_escape: new Blob(['content']) },
    })

    const history = await buildProviderHistory(ctx, providerData(), [])

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              '<attachment reference="attachment:share-escape/bad%22%0A%3Cname%3E.txt" filename="bad&quot; &lt;name&gt;.txt" mediaType="text/plain" bytes="7">\n' +
              'Use read_attachment with this reference to read the file in bounded ranges.\n' +
              '</attachment>',
          },
        ],
      },
    ])
  })

  test('keeps large text attachments out of provider context', async () => {
    const message = attachmentMessage('att_long', 'text/plain', 'long.txt')
    const ctx = attachmentHistoryCtx({
      message,
      attachment: {
        storageId: 'blob_long',
        mediaType: 'text/plain',
        filename: 'long.txt',
        shareToken: 'share-long',
        byteLength: 50_001,
      },
      blobs: { blob_long: new Blob(['x'.repeat(50_001)]) },
    })

    const history = await buildProviderHistory(ctx, providerData(), [])
    const part = firstContentPart(history)

    expect(part?.type).toBe('text')
    expect(part?.type === 'text' && part.text.includes('bytes="50001"')).toBe(
      true,
    )
    expect(part?.type === 'text' && part.text.includes('x'.repeat(100))).toBe(
      false,
    )
  })
})
