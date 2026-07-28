/// <reference types="bun-types" />
import {
  findHtmlSpans,
  hasOnlyAllowedTags,
  isWholeHtml,
} from '@/lib/markdown/html-scan'
import { describe, expect, test } from 'bun:test'

const htmlOf = (text: string) => findHtmlSpans(text).map((span) => span.html)

describe('html span scanning', () => {
  test('finds a balanced element', () => {
    expect(htmlOf('a <strong>b</strong> c')).toEqual(['<strong>b</strong>'])
  })

  test('reports outermost elements only', () => {
    expect(htmlOf('<b>x<i>y</i>z</b>')).toEqual(['<b>x<i>y</i>z</b>'])
    expect(htmlOf('<b>x<b>y</b>z</b>')).toEqual(['<b>x<b>y</b>z</b>'])
  })

  test('finds several elements in one run', () => {
    expect(htmlOf('<b>x</b> and <i>y</i>')).toEqual(['<b>x</b>', '<i>y</i>'])
  })

  test('tolerates angle brackets inside quoted attributes', () => {
    expect(htmlOf('<img src="a>b.png" alt=\'x>y\'>')).toEqual([
      '<img src="a>b.png" alt=\'x>y\'>',
    ])
  })

  test('matches void and self-closing tags', () => {
    expect(htmlOf('line<br>break')).toEqual(['<br>'])
    expect(htmlOf('<hr/>')).toEqual(['<hr/>'])
    expect(htmlOf('<b/>')).toEqual(['<b/>'])
  })

  test('spans multiple lines', () => {
    const source = '<div>\n<b>x</b>\n</div>'
    expect(htmlOf(source)).toEqual([source])
  })

  test('ignores incomplete markup', () => {
    expect(htmlOf('<b>unclosed')).toEqual([])
    expect(htmlOf('orphan </b> close')).toEqual([])
  })

  test('ignores tags the sanitizer would strip', () => {
    expect(htmlOf('Use <system-reminder> tags')).toEqual([])
    expect(htmlOf('<example>x</example>')).toEqual([])
    expect(htmlOf('<script>alert(1)</script>')).toEqual([])
    expect(htmlOf('<tag1>')).toEqual([])
  })

  test('ignores text that only looks like a tag', () => {
    expect(htmlOf('1 < 2 and a<b')).toEqual([])
    expect(htmlOf('Array<number> generic')).toEqual([])
  })

  test('skips over comments without scanning inside them', () => {
    expect(htmlOf('<!-- <b>x</b> -->')).toEqual([])
  })
})

describe('top-level tag allowance', () => {
  test('accepts allowed tags', () => {
    expect(hasOnlyAllowedTags('<div style="color:red">x</div>')).toBe(true)
    expect(hasOnlyAllowedTags('plain text, 1 < 2')).toBe(true)
    expect(hasOnlyAllowedTags('<!-- <example> -->')).toBe(true)
  })

  test('accepts unknown tags nested inside an allowed element', () => {
    expect(hasOnlyAllowedTags('<div>\n<label>x</label>\n</div>')).toBe(true)
  })

  test('accepts the dangling halves of html wrapped around markdown', () => {
    expect(hasOnlyAllowedTags('<div class="wrap">')).toBe(true)
    expect(hasOnlyAllowedTags('</div>')).toBe(true)
  })

  test('rejects an unknown tag at the top level', () => {
    expect(hasOnlyAllowedTags('<system-reminder>')).toBe(false)
    expect(hasOnlyAllowedTags('</system-reminder>')).toBe(false)
    expect(hasOnlyAllowedTags('<div>a</div>\n<example>b</example>')).toBe(false)
  })
})

describe('whole-block html', () => {
  test('accepts a block that is one element', () => {
    expect(isWholeHtml('<div>\n<b>x</b>\n</div>')).toBe(true)
    expect(isWholeHtml('  <b>x</b>  ')).toBe(true)
  })

  test('rejects anything else', () => {
    expect(isWholeHtml('text <b>x</b>')).toBe(false)
    expect(isWholeHtml('<b>x</b><i>y</i>')).toBe(false)
    expect(isWholeHtml('<example>\nx\n</example>')).toBe(false)
    expect(isWholeHtml('')).toBe(false)
  })
})
