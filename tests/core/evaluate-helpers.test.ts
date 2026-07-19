/// <reference types="bun-types" />
import { evaluate } from '@sb/core/interpreter/evaluate'
import { describe, expect, test } from 'bun:test'

describe('evaluate file helper', () => {
  test('injects file contents through the helper', () => {
    const result = evaluate(
      "{{ $file('AGENTS.md') }}",
      {},
      undefined,
      { file: (path) => `contents of ${path}` },
    )
    expect(result).toBe('contents of AGENTS.md')
  })

  test('works inside code blocks', () => {
    const text = [
      '$```',
      "const content = $file('AGENTS.md')",
      'if (content) {',
      '  return `<file path="AGENTS.md">\\n${content}\\n</file>`',
      '}',
      '```',
    ].join('\n')

    expect(evaluate(text, {}, undefined, { file: () => 'Use bun.' })).toBe(
      '<file path="AGENTS.md">\nUse bun.\n</file>',
    )
    expect(evaluate(text, {}, undefined, { file: () => '' })).toBe('')
  })

  test('forwards the wrap argument to the helper', () => {
    const file = (path: string, wrap = true) =>
      wrap ? `<file path="${path}">wrapped</file>` : 'raw'
    expect(evaluate("{{ $file('AGENTS.md') }}", {}, undefined, { file })).toBe(
      '<file path="AGENTS.md">wrapped</file>',
    )
    expect(
      evaluate("{{ $file('AGENTS.md', false) }}", {}, undefined, { file }),
    ).toBe('raw')
  })

  test('defaults to an empty string when no helper is provided', () => {
    expect(evaluate("{{ $file('AGENTS.md') }}")).toBe('')
  })

  test('renders empty when the helper throws', () => {
    const result = evaluate("{{ $file('../escape') }}", {}, undefined, {
      file: () => {
        throw new Error('Path escapes the configured workspace')
      },
    })
    expect(result).toBe('')
  })
})
