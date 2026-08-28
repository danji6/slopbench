/// <reference types="bun-types" />
import { nextStickyBottomState } from '@/hooks/scroll'
import { describe, expect, test } from 'bun:test'

const state = (
  overrides: Partial<Parameters<typeof nextStickyBottomState>[0]> = {},
) =>
  nextStickyBottomState({
    isStuck: true,
    distanceFromBottom: 0,
    unstickDistance: 160,
    autoScrolling: false,
    suspended: false,
    ...overrides,
  })

describe('nextStickyBottomState', () => {
  test('ignores provisional measurements before initial positioning settles', () => {
    expect(state({ distanceFromBottom: 500, suspended: true })).toBe(true)
  })

  test('unsticks when content growth moves the bottom too far away', () => {
    expect(state({ distanceFromBottom: 160 })).toBe(false)
  })

  test('does not unstick during active autoscrolling', () => {
    expect(state({ distanceFromBottom: 500, autoScrolling: true })).toBe(true)
  })

  test('does not reveal an already hidden composer during autoscrolling', () => {
    expect(
      state({
        isStuck: false,
        distanceFromBottom: 500,
        autoScrolling: true,
      }),
    ).toBe(false)
  })

  test('resticks once the viewport reaches the bottom', () => {
    expect(state({ isStuck: false, distanceFromBottom: 19 })).toBe(true)
  })
})
