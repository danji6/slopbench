/// <reference types="bun-types" />
import { formatMarkdown } from '@/lib/markdown/format'
import { describe, expect, test } from 'bun:test'

describe('formatMarkdown', () => {
  test('strips whitespace at the end of a line', () => {
    expect(formatMarkdown('lorem ipsum  \ndolor')).toBe('lorem ipsum\ndolor')
    expect(formatMarkdown('tabs\t\nand \t spaces \t')).toBe(
      'tabs\nand \t spaces',
    )
    expect(formatMarkdown('# Head  \n\n- one \n- two')).toBe(
      '# Head\n\n- one\n- two',
    )
  })

  test('empties whitespace-only lines', () => {
    expect(formatMarkdown('a\n   \nb')).toBe('a\n\nb')
  })

  test('keeps deliberate blank lines', () => {
    expect(formatMarkdown('<tag1>\n\n\n\n<tag2>')).toBe('<tag1>\n\n\n\n<tag2>')
  })

  test('normalizes line endings', () => {
    expect(formatMarkdown('a  \r\nb\r\n\r\nc')).toBe('a\nb\n\nc')
  })

  test('trims the document', () => {
    expect(formatMarkdown('\n\n  \nlorem\n  \n\n')).toBe('lorem')
  })

  test('keeps whitespace inside fenced code', () => {
    expect(formatMarkdown('```ts\nconst a = 1  \n```\n\ntext  ')).toBe(
      '```ts\nconst a = 1  \n```\n\ntext',
    )
    expect(formatMarkdown('~~~\nkeep  \n~~~\n\ntext  ')).toBe(
      '~~~\nkeep  \n~~~\n\ntext',
    )
  })

  test('keeps whitespace inside a dynamic block', () => {
    expect(formatMarkdown('$```\nreturn 1  \n```\n\ntext  ')).toBe(
      '$```\nreturn 1  \n```\n\ntext',
    )
  })

  // Without this, one fence inside another inverts the state for the rest of
  // the document and half the content silently stops being formatted.
  test('only closes a fence on a matching delimiter', () => {
    expect(formatMarkdown('````md\n```  \n````\n\ntext  ')).toBe(
      '````md\n```  \n````\n\ntext',
    )
    expect(formatMarkdown('~~~\n```  \n~~~\n\ntext  ')).toBe(
      '~~~\n```  \n~~~\n\ntext',
    )
  })

  test('formats content after an unterminated fence closes', () => {
    expect(formatMarkdown('```\ncode  \n```\nafter  \n\nmore  ')).toBe(
      '```\ncode  \n```\nafter\n\nmore',
    )
  })
})
