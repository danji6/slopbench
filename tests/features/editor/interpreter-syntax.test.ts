/// <reference types="bun-types" />
import {
  isInCodeContext,
  scanInterpreterSyntax,
} from '@/lib/tiptap/interpreter-syntax'
import { describe, expect, test } from 'bun:test'

/** Returns the text each token covers, tagged by kind. */
function slices(text: string): string[] {
  return scanInterpreterSyntax(text).map(
    (t) => `${t.kind}:${text.slice(t.from, t.to)}`,
  )
}

describe('scanInterpreterSyntax', () => {
  test('single-line if with expression', () => {
    expect(slices('#if userCount > 1')).toEqual([
      'keyword:#if',
      'code:userCount > 1',
    ])
  })

  test('else and endif keywords', () => {
    expect(slices('#else')).toEqual(['keyword:#else'])
    expect(slices('#endif')).toEqual(['keyword:#endif'])
  })

  test('eval block with multiline body', () => {
    const text = '#eval\nconst x = 1\nreturn x\n#end'
    expect(slices(text)).toEqual([
      'keyword:#eval',
      'code:const x = 1\nreturn x',
      'keyword:#end',
    ])
  })

  test('bare if condition closed by then', () => {
    const text = '#if\nreturn userCount > 1\n#then'
    expect(slices(text)).toEqual([
      'keyword:#if',
      'code:return userCount > 1',
      'keyword:#then',
    ])
  })

  test('a bare if keyword highlights before its then closer exists', () => {
    expect(slices('#if')).toEqual(['keyword:#if'])
    expect(slices('#elif')).toEqual(['keyword:#elif'])
    // the body is left as prose until #then appears
    expect(slices('#if\nuserCount > 1')).toEqual(['keyword:#if'])
  })

  test('inline braces', () => {
    expect(slices('Hi {{ user }} there')).toEqual([
      'keyword:{{',
      'code: user ',
      'keyword:}}',
    ])
  })

  test('an unclosed eval block is not treated as a block', () => {
    expect(slices('#eval\nreturn 1')).toEqual([])
  })

  test('body outside the block is left alone', () => {
    const text = '#if x\nplain body {{ user }}\n#endif'
    expect(slices(text)).toEqual([
      'keyword:#if',
      'code:x',
      'keyword:{{',
      'code: user ',
      'keyword:}}',
      'keyword:#endif',
    ])
  })
})

describe('isInCodeContext', () => {
  test('inside a single-line expression', () => {
    const text = '#if userCount > 1'
    expect(isInCodeContext(text, text.length)).toBe(true)
    expect(isInCodeContext(text, 1)).toBe(false) // within `#if`
  })

  test('inside an eval body before the closer is typed', () => {
    const text = '#eval\nreturn getVar('
    expect(isInCodeContext(text, text.length)).toBe(true)
  })

  test('inside inline braces only', () => {
    const text = 'Hi {{ user }} bye'
    expect(isInCodeContext(text, text.indexOf('user'))).toBe(true)
    expect(isInCodeContext(text, text.length)).toBe(false)
  })

  test('plain body is not a code context', () => {
    const text = '#if x\nbody\n#endif'
    expect(isInCodeContext(text, text.indexOf('body') + 1)).toBe(false)
  })
})
