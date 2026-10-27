/// <reference types="bun-types" />
import {
  attachmentMarkdownLink,
  attachmentPath,
  attachmentRef,
  attachmentReference,
  attachmentReferences,
  attachmentToken,
  attachmentTokens,
  readUtf8Range,
  shouldAttachTextPaste,
} from '@sb/core/attachments'
import { describe, expect, test } from 'bun:test'

describe('durable attachment links', () => {
  test('round trips encoded tokens and filenames', () => {
    const path = attachmentPath('secret token', 'notes #1.txt')
    const ref = attachmentRef('secret token', 'notes #1.txt')
    expect(path).toBe('/attachments/secret%20token/notes%20%231.txt')
    expect(ref).toBe('attachment:secret%20token/notes%20%231.txt')
    expect(attachmentMarkdownLink('secret token', 'notes #1.txt')).toBe(
      '[📎 notes #1.txt](attachment:secret%20token/notes%20%231.txt)',
    )
    expect(attachmentToken(`https://example.test${path}`)).toBe('secret token')
    expect(attachmentReference(`https://example.test${path}`)).toEqual({
      token: 'secret token',
      filename: 'notes #1.txt',
    })
    expect(attachmentReference(ref)).toEqual({
      token: 'secret token',
      filename: 'notes #1.txt',
    })
  })

  test('finds ordinary and markdown links but ignores code', () => {
    const text = [
      'https://example.test/attachments/one/a.txt',
      '[two](https://example.test/attachments/two/b.txt)',
      '[three](attachment:three/c.txt)',
      '`https://example.test/attachments/inline/c.txt`',
      '```',
      'https://example.test/attachments/fenced/d.txt',
      '```',
    ].join('\n')
    expect(attachmentTokens(text)).toEqual(['one', 'two', 'three'])
    expect(attachmentReferences(text)).toEqual([
      { token: 'one', filename: 'a.txt' },
      { token: 'two', filename: 'b.txt' },
      { token: 'three', filename: 'c.txt' },
    ])
  })

  test('ignores mismatched fence markers and malformed tokens', () => {
    const text = [
      '````text',
      '/attachments/hidden/file.txt',
      '~~~',
      '/attachments/still-hidden/file.txt',
      '````',
      '/attachments/visible/file.txt',
    ].join('\n')
    expect(attachmentTokens(text)).toEqual(['visible'])
    expect(attachmentToken('/attachments/%E0%A4%A/file.txt')).toBeNull()
  })
})

describe('large text pastes', () => {
  test('uses UTF-8 bytes at the 16 KiB boundary', () => {
    expect(shouldAttachTextPaste('x'.repeat(16 * 1024 - 1))).toBe(false)
    expect(shouldAttachTextPaste('x'.repeat(16 * 1024))).toBe(true)
    expect(shouldAttachTextPaste('🙂'.repeat(4096))).toBe(true)
  })

  test('keeps shell and slash commands inline', () => {
    const tail = 'x'.repeat(16 * 1024)
    expect(shouldAttachTextPaste(`/system ${tail}`)).toBe(false)
    expect(shouldAttachTextPaste(`$ echo ${tail}`)).toBe(false)
    expect(shouldAttachTextPaste(tail, true)).toBe(false)
  })
})

describe('readUtf8Range', () => {
  const bytes = new TextEncoder().encode('A🙂BéC')

  test('never splits a multi-byte code point', () => {
    expect(readUtf8Range(bytes, 1, 2)).toMatchObject({
      content: '🙂',
      offset: 1,
      endOffset: 5,
      nextOffset: 5,
      eof: false,
      truncated: true,
    })
  })

  test('advances an offset that points into a code point', () => {
    expect(readUtf8Range(bytes, 3, 3)).toMatchObject({
      content: 'Bé',
      offset: 5,
      endOffset: 8,
      nextOffset: 8,
    })
  })

  test('reports EOF with the authoritative byte length', () => {
    expect(readUtf8Range(bytes, 8, 64)).toEqual({
      content: 'C',
      offset: 8,
      endOffset: 9,
      nextOffset: null,
      totalBytes: 9,
      eof: true,
      truncated: false,
    })
  })

  test('honors large byte limits deterministically', () => {
    const large = new TextEncoder().encode('0123456789'.repeat(12_000))

    for (const limit of [300, 400, 1_200, 5_000, 20_000, 65_536]) {
      const first = readUtf8Range(large, 0, limit)
      const second = readUtf8Range(large, 0, limit)
      expect(new TextEncoder().encode(first.content)).toHaveLength(limit)
      expect(first).toEqual(second)
      expect(first.endOffset).toBe(limit)
      expect(first.nextOffset).toBe(limit)
      expect(first.truncated).toBe(true)
    }
  })
})
