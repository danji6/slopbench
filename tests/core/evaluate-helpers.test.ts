/// <reference types="bun-types" />
import { evaluate } from '@sb/core/interpreter/evaluate'
import { describe, expect, test } from 'bun:test'

describe('evaluate file helper', () => {
  test('injects file contents through the helper', () => {
    const result = evaluate("{{ readFile('AGENTS.md') }}", {}, undefined, {
      readFile: (path) => `contents of ${path}`,
    })
    expect(result).toBe('contents of AGENTS.md')
  })

  test('works inside code blocks', () => {
    const text = [
      '$```',
      "const content = readFile('AGENTS.md')",
      'if (content) {',
      '  return `<file path="AGENTS.md">\\n${content}\\n</file>`',
      '}',
      '```',
    ].join('\n')

    expect(evaluate(text, {}, undefined, { readFile: () => 'Use bun.' })).toBe(
      '<file path="AGENTS.md">\nUse bun.\n</file>',
    )
    expect(evaluate(text, {}, undefined, { readFile: () => '' })).toBe('')
  })

  test('forwards the wrap argument to the helper', () => {
    const readFile = (path: string, wrap = true) =>
      wrap ? `<file path="${path}">wrapped</file>` : 'raw'
    expect(
      evaluate("{{ readFile('AGENTS.md') }}", {}, undefined, { readFile }),
    ).toBe('<file path="AGENTS.md">wrapped</file>')
    expect(
      evaluate("{{ readFile('AGENTS.md', false) }}", {}, undefined, {
        readFile,
      }),
    ).toBe('raw')
  })

  test('defaults to an empty string when no helper is provided', () => {
    expect(evaluate("{{ readFile('AGENTS.md') }}")).toBe('')
  })

  test('renders empty when the helper throws', () => {
    const result = evaluate("{{ readFile('../escape') }}", {}, undefined, {
      readFile: () => {
        throw new Error('Path escapes the configured workspace')
      },
    })
    expect(result).toBe('')
  })
})

describe('evaluate fileExists helper', () => {
  test('gates a conditional block on file existence', () => {
    const text = [
      "#if fileExists('AGENTS.md')",
      "{{ readFile('AGENTS.md') }}",
      '#endif',
    ].join('\n')

    const helpers = {
      fileExists: (path: string) => path === 'AGENTS.md',
      readFile: () => 'Use bun.',
    }
    expect(evaluate(text, {}, undefined, helpers)).toBe('Use bun.')
    expect(
      evaluate(text, {}, undefined, {
        ...helpers,
        fileExists: () => false,
      }),
    ).toBe('')
  })

  test('defaults to false when no helper is provided', () => {
    const text = ['#if fileExists("AGENTS.md")', 'shown', '#endif'].join('\n')
    expect(evaluate(text)).toBe('')
  })
})
