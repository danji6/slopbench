/// <reference types="bun-types" />
import { AVATAR_MAX, AVATAR_MIN, avatarGutter, avatarVars } from '@/lib/chat'
import { describe, expect, test } from 'bun:test'

const steps = Array.from(
  { length: (AVATAR_MAX - AVATAR_MIN) / 2 + 1 },
  (_, i) => AVATAR_MIN + i * 2,
)

describe('avatar geometry', () => {
  test('40px reproduces the hand-tuned offsets', () => {
    const vars = avatarVars(40)
    expect(vars['--avatar-size']).toBe('40px')
    expect(Number(vars['--avatar-lift'])).toBeCloseTo(1 / 3.5, 6)
    expect(Number(vars['--avatar-drop'])).toBeCloseTo(1 / 7, 6)
  })

  // A negative drop would push the avatar above the header line, out of its own
  // row and into the message above, instead of centring it below the header.
  // This is the invariant AVATAR_MAX exists to hold, and it breaks first if
  // someone raises the cap.
  test('no size drops upwards', () => {
    for (const size of steps) {
      expect(Number(avatarVars(size)['--avatar-drop'])).toBeGreaterThanOrEqual(
        0,
      )
    }
  })

  // The lift is what keeps the header row 24px tall whatever the avatar does.
  test('the lift always cancels the avatar against the header line', () => {
    for (const size of steps) {
      const vars = avatarVars(size)
      const gutter = size + 16
      expect(Number(vars['--avatar-lift']) * gutter).toBeCloseTo(size - 24, 6)
    }
  })

  test('sizes outside the range are clamped, odd ones snapped', () => {
    expect(avatarVars(8)['--avatar-size']).toBe(`${AVATAR_MIN}px`)
    expect(avatarVars(200)['--avatar-size']).toBe(`${AVATAR_MAX}px`)
    expect(avatarGutter(800, 200)).toContain(`${AVATAR_MAX + 16}px)`)
    expect(avatarVars(41)['--avatar-size']).toBe('42px')
    expect(avatarVars(38.5)['--avatar-size']).toBe('38px')
  })

  test('the gutter clamp opens to the avatar plus its gap', () => {
    expect(avatarGutter(800, 32)).toContain('48px)')
    expect(avatarGutter(800, 48)).toContain('64px)')
  })
})
