/// <reference types="bun-types" />
import { evaluate } from '@sb/core/interpreter/evaluate'
import { createVariableStore } from '@sb/core/interpreter/store'
import { describe, expect, test } from 'bun:test'

describe('conditional blocks', () => {
  test('includes content when the condition is true', () => {
    const text = [
      'Intro.',
      '#if userCount > 1',
      'Be concise.',
      '#endif',
      'End.',
    ].join('\n')
    expect(evaluate(text, { userCount: 2 })).toBe('Intro.\nBe concise.\nEnd.')
  })

  test('excludes content and its lines when the condition is false', () => {
    const text = [
      'Intro.',
      '#if userCount > 1',
      'Be concise.',
      '#endif',
      'End.',
    ].join('\n')
    expect(evaluate(text, { userCount: 1 })).toBe('Intro.\nEnd.')
  })

  test('selects the first matching branch in an if/elif/else chain', () => {
    const text = [
      '#if userCount > 2',
      'many',
      '#elif userCount > 1',
      'pair',
      '#else',
      'solo',
      '#endif',
    ].join('\n')
    expect(evaluate(text, { userCount: 3 })).toBe('many')
    expect(evaluate(text, { userCount: 2 })).toBe('pair')
    expect(evaluate(text, { userCount: 1 })).toBe('solo')
  })

  test('drops a nested block when its outer condition is false', () => {
    const text = [
      '#if isAdmin',
      'outer',
      '#if userCount > 1',
      'inner',
      '#endif',
      '#endif',
    ].join('\n')
    expect(evaluate(text, { isAdmin: false, userCount: 5 })).toBe('')
    expect(evaluate(text, { isAdmin: true, userCount: 5 })).toBe('outer\ninner')
    expect(evaluate(text, { isAdmin: true, userCount: 1 })).toBe('outer')
  })

  test('auto-closes an unclosed #if at end of text', () => {
    const text = [
      'Head.',
      '#if userCount > 1',
      'tail line 1',
      'tail line 2',
    ].join('\n')
    expect(evaluate(text, { userCount: 2 })).toBe(
      'Head.\ntail line 1\ntail line 2',
    )
    expect(evaluate(text, { userCount: 1 })).toBe('Head.')
  })

  test('drops the branch silently when the condition throws', () => {
    const text = ['#if boom()', 'hidden', '#endif', 'shown'].join('\n')
    expect(evaluate(text)).toBe('shown')
  })

  test('drops the branch silently when the condition fails to compile', () => {
    const text = ['#if )(', 'hidden', '#endif', 'shown'].join('\n')
    expect(evaluate(text)).toBe('shown')
  })

  test('supports a dynamic block as the condition', () => {
    const text = [
      '#if $```',
      'return userCount > 1 && isAdmin',
      '```',
      'privileged group instructions',
      '#endif',
    ].join('\n')
    expect(evaluate(text, { userCount: 2, isAdmin: true })).toBe(
      'privileged group instructions',
    )
    expect(evaluate(text, { userCount: 2, isAdmin: false })).toBe('')
  })

  test('does not execute segments inside a non-taken branch', () => {
    const store = createVariableStore()
    const text = ['#if false', "{{ setVar('touched', true) }}", '#endif'].join(
      '\n',
    )
    evaluate(text, {}, store)
    expect(store.get('touched')).toBeUndefined()
    expect(store.isDirty()).toBe(false)
  })

  test('executes segments inside a taken branch', () => {
    const store = createVariableStore()
    const text = ['#if true', "{{ setVar('touched', true) }}", '#endif'].join(
      '\n',
    )
    evaluate(text, {}, store)
    expect(store.get('touched')).toBe(true)
  })

  test('does not treat directives inside a code fence as conditionals', () => {
    const text = ['```', '#if userCount > 1', 'literal', '#endif', '```'].join(
      '\n',
    )
    expect(evaluate(text, { userCount: 1 })).toBe(text)
  })

  test('keeps an else branch when the if condition is false', () => {
    const text = ['#if false', 'A', '#else', 'B', '#endif'].join('\n')
    expect(evaluate(text)).toBe('B')
  })
})
