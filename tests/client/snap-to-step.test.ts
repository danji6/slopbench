/// <reference types="bun-types" />
import { snapToStep } from '@/lib/math'
import { describe, expect, test } from 'bun:test'

describe('snapToStep', () => {
  test('snaps onto the grid the slider itself moves on', () => {
    expect(snapToStep(41, 2, 32)).toBe(42)
    expect(snapToStep(38.5, 2, 32)).toBe(38)
    expect(snapToStep(743, 20, 600)).toBe(740)
  })

  // The grid is anchored at the minimum, which need not be a multiple of step.
  test('anchors on the origin', () => {
    expect(snapToStep(10, 4, 1)).toBe(9)
    expect(snapToStep(10, 4, 0)).toBe(12)
  })

  // Fractional steps must not leak binary float noise into a stored setting.
  test('keeps the precision of the step', () => {
    expect(snapToStep(0.28, 0.05, 0)).toBe(0.3)
    expect(snapToStep(0.334, 0.01, 0)).toBe(0.33)
    expect(snapToStep(1.15, 0.1, 0.05)).toBe(1.15)
  })

  test('leaves the value alone without a usable step', () => {
    expect(snapToStep(41, 0, 32)).toBe(41)
    expect(snapToStep(41, Number.NaN, 32)).toBe(41)
  })
})
