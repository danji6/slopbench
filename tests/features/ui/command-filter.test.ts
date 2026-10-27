/// <reference types="bun-types" />
import { commandFilter as score } from '@sb/client/lib/command-filter'
import { describe, expect, test } from 'bun:test'

/** A Convex-shaped opaque id. */
const ARIA_ID = 'j5712fpdppdt0v3wpwx8v0kq1h7fbcnx'
const LUNA_ID = 'jd7a1r9k2mq0xn4c8vb3t5wz6yh0sfge'

describe('commandFilter', () => {
  test('scores keywords instead of the opaque value', () => {
    expect(score(ARIA_ID, 'aria', ['Aria'])).toBeGreaterThan(0)
    expect(score(LUNA_ID, 'aria', ['Luna'])).toBe(0)
  })

  test('ignores an id that fuzzily matches the search', () => {
    // "ar" is a subsequence of both ids, and Luna's happens to score higher —
    // scoring the value would rank an unrelated agent above the real match.
    expect(score(LUNA_ID, 'ar', [])).toBeGreaterThan(score(ARIA_ID, 'ar', []))
    expect(score(ARIA_ID, 'ar', ['Aria'])).toBeGreaterThan(
      score(LUNA_ID, 'ar', ['Luna']),
    )
    expect(score(LUNA_ID, 'ar', ['Luna'])).toBe(0)
  })

  test('ranks a leading match above a trailing one', () => {
    expect(score(ARIA_ID, 'a', ['Aria'])).toBeGreaterThan(
      score(LUNA_ID, 'a', ['Luna']),
    )
  })

  test('scores identical names identically, whatever the id', () => {
    expect(score(ARIA_ID, 'aria', ['Aria'])).toBe(
      score(LUNA_ID, 'aria', ['Aria']),
    )
  })

  test('falls back to the value when no keywords are given', () => {
    expect(score('system', 'sys')).toBeGreaterThan(0)
    expect(score('system', 'dark')).toBe(0)
  })
})
