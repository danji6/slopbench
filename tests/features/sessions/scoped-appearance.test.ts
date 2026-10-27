/// <reference types="bun-types" />
import { scopedAppearance } from '@/lib/chat/scoped-appearance'
import { describe, expect, test } from 'bun:test'

/** Non-null, so the assertions read as the callers do. */
function scope(look: Parameters<typeof scopedAppearance>[0]) {
  const result = scopedAppearance(look)
  if (!result) throw new Error('expected a scope')
  return result
}

describe('scoped appearance', () => {
  test('the same look resolves to the same class', () => {
    // What lets every row of every message wearing a look share one stylesheet
    expect(scope({ css: ['.a { color: red }'] }).key).toBe(
      scope({ css: ['.a { color: red }'] }).key,
    )
  })

  test('different css gets its own class', () => {
    expect(scope({ css: ['.a {}'] }).key).not.toBe(
      scope({ css: ['.b {}'] }).key,
    )
  })

  test('the same css under a different theme gets its own class', () => {
    const light = scope({ css: ['.a {}'], vars: '--primary:#fff;' })
    const dark = scope({ css: ['.a {}'], vars: '--primary:#000;' })

    expect(light.key).not.toBe(dark.key)
    expect(scope({ css: ['.a {}'] }).key).not.toBe(light.key)
  })

  test('the rule declares the theme on the root and scopes the css', () => {
    const { key, rule } = scope({
      css: ['.a { color: red }'],
      vars: '--primary:#fff;',
    })

    expect(rule).toContain(`.${key}{--primary:#fff;}`)
    expect(rule).toContain(`@scope (.${key}) {`)
    expect(rule).toContain('.a { color: red }')
  })

  test('blocks land in one rule, later ones last', () => {
    // What makes an agent's rules win over the user's on their own messages
    const { rule } = scope({ css: ['.a { color: red }', '.a { color: blue }'] })

    expect(rule.indexOf('color: red')).toBeLessThan(rule.indexOf('color: blue'))
  })

  test('an absent block leaves the others untouched', () => {
    expect(scope({ css: [undefined, '.a {}', null] }).key).toBe(
      scope({ css: ['.a {}'] }).key,
    )
  })

  test('the same blocks in the other order get their own class', () => {
    expect(scope({ css: ['.a {}', '.b {}'] }).key).not.toBe(
      scope({ css: ['.b {}', '.a {}'] }).key,
    )
  })

  test('a theme applies on its own, with no css to carry it', () => {
    const { key, className, rule } = scope({ vars: '--primary:#fff;' })

    expect(rule).toBe(`.${key}{--primary:#fff;}`)
    expect(className).toContain('theme-scope')
  })

  test('a theme scope re-derives the half the document is showing', () => {
    // `.theme-scope.light` and `.dark` hold the mode-dependent derivations
    expect(scope({ vars: '--primary:#fff;', isDark: true }).className).toBe(
      `${scope({ vars: '--primary:#fff;', isDark: true }).key} theme-scope dark`,
    )
    expect(scope({ vars: '--primary:#fff;' }).className).toEndWith(
      'theme-scope light',
    )
  })

  test('css alone never carries the theme classes', () => {
    const { key, className } = scope({ css: ['.a {}'], isDark: true })

    expect(className).toBe(key)
  })

  test('nothing to scope resolves to nothing', () => {
    expect(scopedAppearance({})).toBeNull()
    expect(scopedAppearance({ css: [], vars: '', isDark: true })).toBeNull()
    expect(scopedAppearance({ css: ['', undefined] })).toBeNull()
  })

  test('the class is a usable selector whatever the css contains', () => {
    expect(scope({ css: ['.a { content: "😀 \\" }" }'] }).key).toMatch(
      /^cc-[0-9a-z]+-[0-9a-z]+$/,
    )
  })
})
