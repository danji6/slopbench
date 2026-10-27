/// <reference types="bun-types" />
import {
  activeAttachmentMessages,
  hasLoadedAttachmentMedia,
} from '@sb/convex/model/attachmentMedia'
import {
  attachmentToModelOutput,
  createReadAttachmentTool,
  expireAttachmentToolPart,
} from '@sb/convex/model/tool/attachments'
import { describe, expect, test } from 'bun:test'

test('settled media attachment tool output expires after its turn', () => {
  const part = {
    type: 'tool-read_attachment',
    state: 'output-available',
    toolCallId: 'call-1',
    output: {
      kind: 'media',
      url: 'https://storage.test/file',
      reference: 'attachment:token/file.png',
      filename: 'file.png',
      mediaType: 'image/png',
      byteLength: 123,
    },
  }

  expect(expireAttachmentToolPart(part)).toEqual({
    ...part,
    output: { ...part.output, kind: 'expired-media' },
  })
})

test('text attachment tool output remains pageable history', () => {
  const part = {
    type: 'tool-read_attachment',
    state: 'output-available',
    output: { kind: 'text', content: 'hello', nextOffset: 5 },
  }
  expect(expireAttachmentToolPart(part)).toBe(part)
})

test('media attachment tool output maps to provider file content', () => {
  const output = {
    kind: 'media' as const,
    url: 'https://storage.test/file',
    reference: 'attachment:token/file.png',
    filename: 'file.png',
    mediaType: 'image/png',
    byteLength: 123,
  }

  expect(attachmentToModelOutput({ output })).toEqual({
    type: 'content',
    value: [
      {
        type: 'text',
        text: 'Loaded file.png (image/png, 123 bytes) from ' + output.reference,
      },
      {
        type: 'file',
        data: { type: 'url', url: new URL(output.url) },
        mediaType: 'image/png',
        filename: 'file.png',
      },
    ],
  })
})

describe('active attachment media', () => {
  const message = (id: string, role: 'user' | 'assistant') => ({
    _id: id as never,
    role,
  })

  test('includes every queued user message since the previous assistant', () => {
    const history = [
      message('old', 'user'),
      message('assistant', 'assistant'),
      message('media', 'user'),
      message('boundary', 'user'),
    ]
    expect(activeAttachmentMessages(history, 'boundary' as never)).toEqual(
      new Set(['media' as never, 'boundary' as never]),
    )
  })

  test('does not reactivate prior media when continuing an assistant turn', () => {
    const history = [message('media', 'user'), message('boundary', 'assistant')]
    expect(activeAttachmentMessages(history, 'boundary' as never)).toEqual(
      new Set(),
    )
  })

  test('detects loaded media tool output and ignores expired output', () => {
    const part = {
      type: 'tool-read_attachment',
      state: 'output-available',
      output: { kind: 'media' },
    }
    expect(hasLoadedAttachmentMedia([part])).toBe(true)
    expect(
      hasLoadedAttachmentMedia([
        { ...part, output: { kind: 'expired-media' } },
      ]),
    ).toBe(false)
  })
})

describe('read_attachment tool', () => {
  test('reads a bounded text window from permanent storage', async () => {
    const ctx = {
      runQuery: async () => ({
        storageId: 'blob1',
        filename: 'notes.txt',
        mediaType: 'text/plain',
        byteLength: 11,
      }),
      storage: {
        get: async () => new Blob(['hello world']),
      },
    }
    const tool = await createReadAttachmentTool(ctx as never)
    const execute = tool.execute as unknown as (
      input: Record<string, unknown>,
    ) => Promise<unknown>

    expect(
      await execute({
        reference: 'attachment:token/notes.txt',
        offset: 6,
        limit: 5,
      }),
    ).toEqual({
      kind: 'text',
      filename: 'notes.txt',
      mediaType: 'text/plain',
      content: 'world',
      offset: 6,
      endOffset: 11,
      nextOffset: null,
      totalBytes: 11,
      eof: true,
      truncated: false,
    })
  })

  test('defaults to 64 KiB and reports truncation explicitly', async () => {
    const text = 'x'.repeat(70_000)
    const ctx = {
      runQuery: async () => ({
        storageId: 'blob1',
        filename: 'notes.txt',
        mediaType: 'text/plain',
        byteLength: text.length,
      }),
      storage: { get: async () => new Blob([text]) },
    }
    const tool = await createReadAttachmentTool(ctx as never)
    const execute = tool.execute as unknown as (
      input: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>

    const output = await execute({
      reference: 'attachment:token/notes.txt',
    })
    expect(new TextEncoder().encode(output.content as string)).toHaveLength(
      65_536,
    )
    expect(output).toMatchObject({
      offset: 0,
      endOffset: 65_536,
      nextOffset: 65_536,
      totalBytes: 70_000,
      eof: false,
      truncated: true,
    })
  })

  test('rejects a reference whose filename does not match its token', async () => {
    const ctx = {
      runQuery: async () => ({
        storageId: 'blob1',
        filename: 'notes.txt',
        mediaType: 'text/plain',
        byteLength: 5,
      }),
      storage: { get: async () => new Blob(['hello']) },
    }
    const tool = await createReadAttachmentTool(ctx as never)
    const execute = tool.execute as unknown as (
      input: Record<string, unknown>,
    ) => Promise<unknown>

    expect(
      execute({
        reference: 'attachment:token/wrong-name.pdf',
      }),
    ).rejects.toThrow('Attachment link is invalid or expired')
  })

  test('returns media as a temporary storage URL plus permanent reference', async () => {
    const reference = 'attachment:token/pixel.png'
    const ctx = {
      runQuery: async () => ({
        storageId: 'blob1',
        filename: 'pixel.png',
        mediaType: 'image/png',
        byteLength: 42,
      }),
      storage: {
        getUrl: async () => 'https://storage.test/blob1',
      },
    }
    const tool = await createReadAttachmentTool(ctx as never)
    const execute = tool.execute as unknown as (
      input: Record<string, unknown>,
    ) => Promise<unknown>

    expect(await execute({ reference })).toEqual({
      kind: 'media',
      url: 'https://storage.test/blob1',
      reference,
      filename: 'pixel.png',
      mediaType: 'image/png',
      byteLength: 42,
    })
  })
})
