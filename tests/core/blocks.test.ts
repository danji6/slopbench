/// <reference types="bun-types" />
import { block, openBlock, systemReminder } from '@sb/core/utils/blocks'
import { fileBlock } from '@sb/core/workspace/blocks'
import { describe, expect, test } from 'bun:test'

describe('block', () => {
  test('wraps content on its own lines', () => {
    expect(block('plan', 'body')).toBe('<plan>\nbody\n</plan>')
  })

  test('renders and escapes attributes', () => {
    expect(openBlock('file', { path: 'a "b" & <c>' })).toBe(
      '<file path="a &quot;b&quot; &amp; &lt;c&gt;">',
    )
  })

  test('collapses control whitespace in attributes', () => {
    expect(openBlock('file', { path: ' a\nb\tc ' })).toBe('<file path="a b c">')
  })
})

describe('fileBlock', () => {
  test('escapes the path exactly once', () => {
    expect(fileBlock('a&b.ts', 'x')).toBe(
      '<file path="a&amp;b.ts">\nx\n</file>',
    )
  })

  test('falls back to a label when the path is blank', () => {
    expect(fileBlock('  ', 'x')).toBe('<file path="file">\nx\n</file>')
  })
})

describe('systemReminder', () => {
  test('joins lines inside one block', () => {
    expect(systemReminder('one', '', 'two')).toBe(
      '<system-reminder>\none\n\ntwo\n</system-reminder>',
    )
  })
})
