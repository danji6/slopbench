/// <reference types="bun-types" />
import {
  read as readCursor,
  save as saveCursor,
} from '@sb/convex/model/attachmentCursors'
import {
  activeAttachmentMessages,
  hasLoadedAttachmentMedia,
} from '@sb/convex/model/attachmentMedia'
import {
  attachmentToModelOutput,
  createReadAttachmentTool,
  expireAttachmentToolPart,
} from '@sb/convex/model/tool/attachments'
import type {
  AttachmentCursorCall,
  SaveAttachmentCursorArgs,
} from '@sb/convex/types'
import type { ReadAttachmentInput } from '@sb/core/types'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { type FunctionReference, getFunctionName } from 'convex/server'

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

const reference = 'attachment:token/notes.txt'
const utf8 = new TextEncoder()
const storageUrl = 'https://storage.test/blob1'

let fetchMock: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined
afterEach(() => {
  fetchMock?.mockRestore()
  fetchMock = undefined
})

type Row = Record<string, unknown> & { _id: string }

function mockDatabase() {
  const rows = new Map<string, Row>()
  const tables = new Map<string, Row[]>()
  const insert = (table: string, value: Record<string, unknown>) => {
    const _id = String(rows.size + 1)
    const row = { _id, ...value }
    rows.set(_id, row)
    if (!tables.has(table)) tables.set(table, [])
    tables.get(table)!.push(row)
    return _id
  }
  return {
    rows,
    tables,
    db: {
      insert,
      get: (id: string) => rows.get(id) ?? null,
      patch: (id: string, value: Record<string, unknown>) => {
        Object.assign(rows.get(id)!, value)
      },
      query: (table: string) => ({
        withIndex: (_index: string, filter: (q: unknown) => unknown) => {
          const terms: [string, unknown][] = []
          const q = {
            eq: (key: string, value: unknown) => {
              terms.push([key, value])
              return q
            },
          }
          filter(q)
          return {
            unique: () => {
              const matches = (tables.get(table) ?? []).filter((row) =>
                terms.every(([key, value]) => row[key] === value),
              )
              if (matches.length > 1)
                throw new Error('Expected at most one row')
              return matches[0] ? structuredClone(matches[0]) : null
            },
          }
        },
      }),
    },
  }
}

type FixtureOptions = {
  filename?: string
  mediaType?: string
  respond?: (start: number, end: number) => Response | undefined
}

async function attachmentTool(blob: Blob, options: FixtureOptions = {}) {
  const { filename = 'notes.txt', mediaType = 'text/plain', respond } = options
  const { db, rows, tables } = mockDatabase()
  const file = {
    storageId: 'blob1',
    filename,
    mediaType,
    byteLength: blob.size,
  }
  const fileId = db.insert('attachmentFiles', file)
  const addExecution = (
    sessionId: string,
    userId: string,
    agentId: string,
    messageId: string,
  ) => {
    rows.set(sessionId, { _id: sessionId, ownerId: userId })
    db.insert('userSessions', { sessionId, userId, role: 'owner' })
    const streamId = db.insert('streams', {
      generation: 1,
      sessionId,
      invokedBy: userId,
      agentId,
      state: { phase: 'streaming', processingMessageId: messageId },
    })
    return { streamId: streamId as never, generation: 1 }
  }
  const execution = addExecution('chat', 'user', 'agent', 'message')
  const ranges: [number, number][] = []
  const fetchRange = async (...[url, init]: Parameters<typeof fetch>) => {
    if (String(url) !== storageUrl) throw new Error('Unexpected storage URL')
    const range = new Headers(init?.headers).get('range')
    const [, start, inclusiveEnd] = /^bytes=(\d+)-(\d+)$/.exec(range ?? '')!
    const end = Number(inclusiveEnd) + 1
    ranges.push([Number(start), end])
    return (
      respond?.(Number(start), end) ??
      new Response(blob.slice(Number(start), end), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${inclusiveEnd}/${blob.size}`,
        },
      })
    )
  }
  fetchMock = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(fetchRange, { preconnect: fetch.preconnect }),
  )
  let saveQueue = Promise.resolve()
  const ctx = {
    runQuery: (
      ref: FunctionReference<'query', 'internal'>,
      args: AttachmentCursorCall,
    ) => {
      if (getFunctionName(ref) === 'attachments:_readCursor')
        return readCursor({ db } as never, args)
      return rows.get(fileId) ?? null
    },
    runMutation: (_ref: unknown, args: SaveAttachmentCursorArgs) => {
      const result = saveQueue.then(() => saveCursor({ db } as never, args))
      saveQueue = result.then(
        () => {},
        () => {},
      )
      return result
    },
    storage: { getUrl: async () => storageUrl },
  }
  let callCount = 0
  const readAs = async (scope: typeof execution) => {
    const tool = await createReadAttachmentTool(ctx as never, scope)
    return async (
      input: ReadAttachmentInput = {},
      callId = `call-${++callCount}`,
    ) => {
      const initial = input.operationId === undefined ? { reference } : {}
      const output = await tool.execute!(
        { ...initial, ...input },
        {
          toolCallId: callId,
          messages: [],
          context: undefined as never,
        },
      )
      if (!('kind' in output))
        throw new Error('Expected a single attachment result')
      return output
    }
  }
  return {
    read: await readAs(execution),
    ranges,
    rows,
    tables,
    fileId,
    otherReader: () =>
      readAs(
        addExecution(
          'other-chat',
          'other-user',
          'other-agent',
          'other-message',
        ),
      ),
  }
}

describe('read_attachment tool', () => {
  test('reads a bounded text window from permanent storage', async () => {
    const { read, ranges } = await attachmentTool(new Blob(['hello world']))
    expect(await read({ offset: 6, limit: 5 })).toEqual({
      kind: 'text',
      filename: 'notes.txt',
      mediaType: 'text/plain',
      content: 'world',
      offset: 6,
      endOffset: 11,
      nextOffset: null,
      operationId: expect.stringMatching(/^[\w-]{12}$/),
      totalBytes: 11,
      eof: true,
      done: true,
      truncated: false,
    })
    expect(ranges).toEqual([[6, 11]])
  })

  test('defaults to 8 KiB and clamps legacy limits', async () => {
    const { read, ranges } = await attachmentTool(
      new Blob(['x'.repeat(70_000)]),
    )
    for (const limit of [undefined, 65_536]) {
      const output = await read({ limit })
      if (output.kind !== 'text') throw new Error('Expected text')
      expect(utf8.encode(output.content)).toHaveLength(8_192)
      expect(output).toMatchObject({
        offset: 0,
        endOffset: 8_192,
        nextOffset: 8_192,
        totalBytes: 70_000,
        eof: false,
        done: false,
        truncated: true,
      })
    }
    expect(ranges.every(([start, end]) => end - start <= 8_199)).toBe(true)
  })

  test('reports malformed UTF-8 at the end of an attachment', async () => {
    const { read } = await attachmentTool(new Blob([new Uint8Array([0x80])]))
    await expect(read({ from: 'end' })).rejects.toThrow('not valid UTF-8')
  })

  test('rejects a reference whose filename does not match its token', async () => {
    const { read } = await attachmentTool(new Blob(['hello']))
    await expect(
      read({ reference: 'attachment:token/wrong-name.pdf' }),
    ).rejects.toThrow('Attachment link is invalid or expired')
  })

  test('returns media as a temporary storage URL plus permanent reference', async () => {
    const filename = 'pixel.png'
    const { read, ranges } = await attachmentTool(new Blob(['image']), {
      filename,
      mediaType: 'image/png',
    })
    const reference = 'attachment:token/pixel.png'
    expect(await read({ reference })).toEqual({
      kind: 'media',
      url: storageUrl,
      reference,
      filename,
      mediaType: 'image/png',
      byteLength: 5,
    })
    expect(ranges).toEqual([])
    await expect(read({ reference, pattern: '.' })).rejects.toThrow(
      'require a UTF-8 text file',
    )
  })

  for (const from of [undefined, 'end'] as const) {
    test(`pages ${from === 'end' ? 'backward' : 'forward'} without losing UTF-8 bytes`, async () => {
      const text = 'A🙂BéC\r\n\uFEFFD'
      const { read } = await attachmentTool(new Blob([text]))
      const pages: string[] = []
      let page = await read({ from, limit: 4 })
      if (page.kind !== 'text') throw new Error('Expected text')
      expect(page.content).toBe(from === 'end' ? '\uFEFFD' : 'A')
      const operationId = page.operationId
      for (let i = 0; i < 10; i++) {
        if (page.kind !== 'text') throw new Error('Expected text')
        expect(page.operationId).toBe(operationId)
        pages.push(page.content)
        if (page.done) break
        page = await read({ operationId })
      }
      expect(page).toMatchObject({ done: true })
      expect((from === 'end' ? pages.reverse() : pages).join('')).toBe(text)
    })
  }
})

describe('read_attachment search', () => {
  test('ignores case across pages unless the pattern opts out', async () => {
    const { read } = await attachmentTool(new Blob(['ÉRROR\néRrOr\nérror']))
    const first = await read({ pattern: '^érror$', limit: 6 })
    expect(first).toMatchObject({
      done: false,
      matches: [{ line: 1, preview: 'ÉRROR' }],
    })
    if (first.kind !== 'search') throw new Error('Expected search')
    expect(await read({ operationId: first.operationId })).toMatchObject({
      matches: [{ line: 2, preview: 'éRrOr' }],
    })
    expect(await read({ pattern: '(?-i)^érror$' })).toMatchObject({
      done: true,
      matches: [{ line: 3, preview: 'érror' }],
    })
  })

  test('keeps scanning a sparse file and matches across chunks on a long line', async () => {
    const first = 'x'.repeat(65_535) + '\r\n'
    const middle = 'a'.repeat(1_200_000)
    const { read, ranges } = await attachmentTool(
      new Blob([first, '🙂BEGIN', middle, 'END\r\nerror 0']),
    )
    const lineStartOffset = utf8.encode(first).length
    const byteOffset = utf8.encode(first + '🙂').length
    const [page, backward] = await Promise.all([
      read({ pattern: 'BEGIN.*END$' }),
      read({ pattern: 'BEGIN.*END$', from: 'end' }),
    ])
    expect(backward).toMatchObject({
      done: true,
      matches: [{ lineFromEnd: 2, byteOffset, lineStartOffset }],
    })
    expect(page).toMatchObject({
      kind: 'search',
      matches: [
        {
          line: 2,
          byteOffset,
          lineStartOffset,
          preview: expect.stringContaining('BEGIN'),
          previewClipped: true,
        },
      ],
      done: true,
    })
    expect(ranges.some(([start]) => start > 1_048_576)).toBe(true)
    expect(ranges.every(([start, end]) => end - start <= 65_536)).toBe(true)
    if (page.kind !== 'search') throw new Error('Expected search')
    const [hit] = page.matches
    expect(await read({ offset: hit!.byteOffset, limit: 5 })).toMatchObject({
      content: 'BEGIN',
    })
    expect(
      await read({ offset: hit!.lineStartOffset, limit: 9 }),
    ).toMatchObject({
      content: '🙂BEGIN',
    })
    expect(await read({ pattern: 'missing' })).toMatchObject({
      matches: [],
      done: true,
    })
  })

  for (const from of [undefined, 'end'] as const) {
    test(`pages ${from === 'end' ? 'latest-first' : 'earliest-first'} within the serialized budget`, async () => {
      const lines = Array.from(
        { length: 15 },
        (_, index) => `hit ${index + 1} ${'\u0001'.repeat(430)}`,
      )
      const { read } = await attachmentTool(
        new Blob([lines.join('\r\n'), '\r\n']),
      )
      const seen: number[] = []
      let page = await read({ pattern: '^hit', from })
      let pageCount = 0
      while (page.kind === 'search' && pageCount < lines.length) {
        expect(utf8.encode(JSON.stringify(page)).length).toBeLessThanOrEqual(
          8_192,
        )
        expect(
          page.matches.every((hit) => utf8.encode(hit.preview).length >= 64),
        ).toBe(true)
        seen.push(
          ...page.matches.map((hit) => (from ? hit.lineFromEnd : hit.line)!),
        )
        pageCount++
        if (page.done) break
        page = await read({ operationId: page.operationId })
      }
      expect(seen).toEqual(lines.map((_, index) => index + 1))
      expect(page).toMatchObject({ done: true })
      expect(pageCount).toBeGreaterThan(1)
    })
  }

  test('starts a new page when the remaining limit would clip the next preview', async () => {
    const first = 'hit ' + 'a'.repeat(116)
    const second = 'hit ' + 'b'.repeat(116)
    const { read } = await attachmentTool(new Blob([first, '\n', second]))
    const page = await read({ pattern: '^hit', limit: 130 })
    if (page.kind !== 'search') throw new Error('Expected search')
    expect(page).toMatchObject({
      done: false,
      matches: [{ line: 1, preview: first }],
    })
    expect(await read({ operationId: page.operationId })).toMatchObject({
      done: true,
      matches: [{ line: 2, preview: second }],
    })
  })

  test('stops at a full page and can return an empty final page', async () => {
    const { read, ranges } = await attachmentTool(
      new Blob(['hit\n', 'x'.repeat(2 * 65_536)]),
    )
    const page = await read({ pattern: 'hit', limit: 3 })
    if (page.kind !== 'search') throw new Error('Expected search')
    expect(page).toMatchObject({
      done: false,
      matches: [{ line: 1, preview: 'hit' }],
    })
    expect(ranges.every(([, end]) => end <= 65_536)).toBe(true)
    expect(await read({ operationId: page.operationId })).toMatchObject({
      done: true,
      matches: [],
    })
  })

  test('does not evaluate the next line after the page fills', async () => {
    const first = 'hit ' + 'a'.repeat(116)
    const { read } = await attachmentTool(
      new Blob([first, '\n', new Uint8Array([0xff])]),
    )
    const page = await read({ pattern: '.', limit: 130 })
    if (page.kind !== 'search') throw new Error('Expected search')
    expect(page).toMatchObject({ done: false, matches: [{ preview: first }] })
    await expect(read({ operationId: page.operationId })).rejects.toThrow(
      'not valid UTF-8',
    )
  })

  test('validates Unicode across a storage boundary and counts tail lines from one', async () => {
    const first = 'x'.repeat(65_535)
    const { read } = await attachmentTool(
      new Blob([first, '🙂needle\r\nlast needle']),
    )
    const page = await read({ pattern: 'needle', from: 'end' })
    expect(page).toMatchObject({
      done: true,
      matches: [
        { lineFromEnd: 1, byteOffset: 65_552, preview: 'last needle' },
        {
          lineFromEnd: 2,
          byteOffset: 65_539,
          preview: expect.stringContaining('🙂needle'),
          previewClipped: true,
        },
      ],
    })
  })

  test('rejects invalid patterns and invalid UTF-8', async () => {
    const { read } = await attachmentTool(new Blob([new Uint8Array([0xff])]))
    await expect(read({ pattern: '[' })).rejects.toThrow(
      'Invalid or unsupported search regex',
    )
    await expect(read({ pattern: '.' })).rejects.toThrow('not valid UTF-8')
  })
})

describe('attachment operation state', () => {
  test('resumes independent searches, replays a call and resolves a race atomically', async () => {
    const { read } = await attachmentTool(new Blob(['hit\nalt\nhit\nalt\nhit']))
    const first = await read({ pattern: 'hit', limit: 3 }, 'start')
    const alt = await read({ pattern: 'alt', limit: 3 })
    if (first.kind !== 'search' || alt.kind !== 'search')
      throw new Error('Expected search')
    expect(first.operationId).not.toBe(alt.operationId)
    const resume = { operationId: first.operationId }
    const second = await read(resume, 'page2')
    expect(second).toMatchObject({
      matches: [{ line: 3, byteOffset: 8, preview: 'hit' }],
    })
    expect(await read(resume, 'page2')).toEqual(second)
    expect(await read({ pattern: 'hit', limit: 3 }, 'start')).toEqual(first)
    expect(await read({ operationId: alt.operationId })).toMatchObject({
      matches: [{ line: 4, byteOffset: 12, preview: 'alt' }],
    })
    const race = await Promise.allSettled([read(resume), read(resume)])
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(
      1,
    )
    expect(race.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({
        message: expect.stringContaining('advanced in another call'),
      }),
    })
    await expect(read({ ...resume, pattern: 'hit' })).rejects.toThrow(
      'Pass operationId alone',
    )
  })

  test('rejects other readers, revoked files and expired operations', async () => {
    const { read, otherReader, rows, fileId, tables } = await attachmentTool(
      new Blob(['hit\nhit']),
    )
    const first = await read({ pattern: 'hit', limit: 3 })
    if (first.kind !== 'search') throw new Error('Expected search')
    const resume = { operationId: first.operationId }
    await expect((await otherReader())(resume)).rejects.toThrow(
      'unavailable or expired',
    )
    const file = rows.get(fileId)!
    rows.delete(fileId)
    await expect(read(resume)).rejects.toThrow(
      'Attachment link is invalid or expired',
    )
    rows.set(fileId, file)
    tables.get('attachmentCursors')![0]!.expiresAt = 0
    await expect(read(resume)).rejects.toThrow('unavailable or expired')
  })

  test('a storage failure leaves the operation available for retry', async () => {
    let ignoreRange = false
    const { read } = await attachmentTool(new Blob(['hit\nhit']), {
      respond: () =>
        ignoreRange ? new Response('wrong', { status: 200 }) : undefined,
    })
    const first = await read({ pattern: 'hit', limit: 3 })
    if (first.kind !== 'search') throw new Error('Expected search')
    const resume = { operationId: first.operationId }
    ignoreRange = true
    await expect(read(resume, 'retry')).rejects.toThrow(
      'did not return the requested byte range',
    )
    ignoreRange = false
    expect(await read(resume, 'retry')).toMatchObject({
      done: true,
      matches: [{ line: 2 }],
    })
  })
})
