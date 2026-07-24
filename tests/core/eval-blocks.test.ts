/// <reference types="bun-types" />
import { evaluate } from '@sb/core/interpreter/evaluate'
import { hasInterpolation, parse } from '@sb/core/interpreter/parse'
import { createVariableStore } from '@sb/core/interpreter/store'
import { describe, expect, test } from 'bun:test'

describe('eval blocks', () => {
  test('injects the return value in place of the block', () => {
    const text = ['before', '#eval', "return 'injected'", '#end', 'after'].join(
      '\n',
    )
    expect(evaluate(text)).toBe('before\ninjected\nafter')
  })

  test('runs multiline logic and persists variables', () => {
    const store = createVariableStore()
    const text = [
      '#eval',
      "setVar('count', 41)",
      "return getVar('count') + 1",
      '#end',
    ].join('\n')
    expect(evaluate(text, {}, store)).toBe('42')
    expect(store.get('count')).toBe(41)
  })

  test('keeps indentation inside the block', () => {
    const text = ['#eval', 'if (true) {', "    return 'ok'", '}', '#end'].join(
      '\n',
    )
    expect(evaluate(text)).toBe('ok')
  })

  test('does not close on a nested #endif line', () => {
    const text = ['#eval', "return '#endif'", '#end'].join('\n')
    expect(evaluate(text)).toBe('#endif')
  })

  test('a code fence shields an eval directive from evaluation', () => {
    const text = ['```', '#eval', "return 'x'", '#end', '```'].join('\n')
    expect(evaluate(text)).toBe(text)
  })

  test('parses as a single block segment', () => {
    const segments = parse(['#eval', 'return 1', '#end'].join('\n'))
    expect(segments).toEqual([{ type: 'block', code: 'return 1' }])
  })

  test('hasInterpolation detects eval blocks', () => {
    expect(hasInterpolation('#eval\nreturn 1\n#end')).toBe(true)
    expect(hasInterpolation('plain text')).toBe(false)
  })
})
