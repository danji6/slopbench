/// <reference types="bun-types" />
import { evaluate } from '@sb/core/interpreter/evaluate'
import type { ReadFileOptions } from '@sb/core/interpreter/types'
import { describe, expect, test } from 'bun:test'

describe('evaluate file helper', () => {
  test('injects file contents through the helper', () => {
    const result = evaluate("{{ readFile('AGENTS.md') }}", {}, undefined, {
      readFile: (path) => `contents of ${path}`,
    })
    expect(result).toBe('contents of AGENTS.md')
  })

  test('works inside eval blocks', () => {
    const text = [
      '#eval',
      "const content = readFile('AGENTS.md')",
      'if (content) {',
      '  return `<file path="AGENTS.md">\\n${content}\\n</file>`',
      '}',
      '#end',
    ].join('\n')

    expect(evaluate(text, {}, undefined, { readFile: () => 'Use bun.' })).toBe(
      '<file path="AGENTS.md">\nUse bun.\n</file>',
    )
    expect(evaluate(text, {}, undefined, { readFile: () => '' })).toBe('')
  })

  test('forwards wrap in the options object to the helper', () => {
    const readFile = (path: string, options?: ReadFileOptions) =>
      options?.wrap !== false ? `<file path="${path}">wrapped</file>` : 'raw'
    expect(
      evaluate("{{ readFile('AGENTS.md') }}", {}, undefined, { readFile }),
    ).toBe('<file path="AGENTS.md">wrapped</file>')
    expect(
      evaluate("{{ readFile('AGENTS.md', { wrap: false }) }}", {}, undefined, {
        readFile,
      }),
    ).toBe('raw')
  })

  test('copies both options and preserves omitted options', () => {
    const calls: unknown[][] = []
    const readFile = (...args: [string, ReadFileOptions?]) => {
      calls.push(args)
      return 'ok'
    }
    for (const source of [
      "readFile('note')",
      "readFile('note', undefined)",
      "readFile('note', {})",
      "readFile('note', { wrap: false, scope: 'agent' })",
    ])
      evaluate(`{{ ${source} }}`, {}, undefined, { readFile })
    expect(calls).toEqual([
      ['note', undefined],
      ['note', undefined],
      ['note', { wrap: undefined, scope: undefined }],
      ['note', { wrap: false, scope: 'agent' }],
    ])
  })

  test.each([
    'false',
    'true',
    'null',
    '[]',
    "'agent'",
    "{ scope: 'other' }",
    "{ wrap: 'false' }",
    '{ wrap: 0 }',
    "undefined, { scope: 'agent' }",
  ])('rejects invalid or legacy options: %s', (options) => {
    expect(() =>
      evaluate(`{{ readFile('note', ${options}) }}`, {}, undefined, {
        readFile: () => 'should not run',
      }),
    ).toThrow('Dynamic JavaScript')
  })

  test('defaults to an empty string when no helper is provided', () => {
    expect(evaluate("{{ readFile('AGENTS.md') }}")).toBe('')
  })

  test('rejects evaluation when the helper throws', () => {
    const result = () =>
      evaluate("{{ readFile('../escape') }}", {}, undefined, {
        readFile: () => {
          throw new Error('Path escapes the configured workspace')
        },
      })
    expect(result).toThrow('Dynamic JavaScript')
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
