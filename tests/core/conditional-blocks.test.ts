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

  test('supports a multiline block as the condition', () => {
    const text = [
      '#if',
      'return userCount > 1 && isAdmin',
      '#then',
      'privileged group instructions',
      '#endif',
    ].join('\n')
    expect(evaluate(text, { userCount: 2, isAdmin: true })).toBe(
      'privileged group instructions',
    )
    expect(evaluate(text, { userCount: 2, isAdmin: false })).toBe('')
  })

  test('supports a multiline block as an elif condition', () => {
    const text = [
      '#if isAdmin',
      'admin',
      '#elif',
      'return userCount > 1',
      '#then',
      'group',
      '#else',
      'solo',
      '#endif',
    ].join('\n')
    expect(evaluate(text, { isAdmin: true, userCount: 3 })).toBe('admin')
    expect(evaluate(text, { isAdmin: false, userCount: 3 })).toBe('group')
    expect(evaluate(text, { isAdmin: false, userCount: 1 })).toBe('solo')
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

// Editor content is stored as markdown, so every authored line arrives blank
// line separated. Directive lines must not leave that padding behind.
describe('directive whitespace', () => {
  test('leaves no gap where a dropped block stood', () => {
    const text = [
      'You are a helpful assistant.',
      '',
      '#if userCount > 1',
      '',
      'Additional instructions.',
      '',
      '#endif',
      '',
      'Be concise.',
    ].join('\n')
    expect(evaluate(text, { userCount: 1 })).toBe(
      'You are a helpful assistant.\n\nBe concise.',
    )
  })

  test('collapses the blank lines that padded a rendered block', () => {
    const text = [
      'You are a helpful assistant.',
      '',
      '',
      '#if userCount > 1',
      '',
      'Additional instructions.',
      '',
      '#endif',
      '',
      '',
      'Be concise.',
    ].join('\n')
    expect(evaluate(text, { userCount: 2 })).toBe(
      'You are a helpful assistant.\n\nAdditional instructions.\n\nBe concise.',
    )
  })

  test('joins the surrounding lines when nothing padded the block', () => {
    const text = [
      'You are a helpful assistant.',
      '#if userCount > 1',
      'Additional instructions.',
      '#endif',
      'Be concise.',
    ].join('\n')
    expect(evaluate(text, { userCount: 1 })).toBe(
      'You are a helpful assistant.\nBe concise.',
    )
  })

  test('removes the line of a block that renders nothing', () => {
    const text = ['A', '', '#eval', 'return null', '#end', '', 'B'].join('\n')
    expect(evaluate(text)).toBe('A\n\nB')
  })

  test('leaves blank lines that neighbour no directive alone', () => {
    const text = ['A', '', '', 'B'].join('\n')
    expect(evaluate(text)).toBe(text)
  })
})
