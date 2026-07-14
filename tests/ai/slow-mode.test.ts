/// <reference types="bun-types" />
import { slowModeRemainingMs } from '@sb/convex/model/chat/send'
import { describe, expect, test } from 'bun:test'

describe('slowModeRemainingMs', () => {
  const now = 1_000_000

  test('is 0 when slow mode is off', () => {
    expect(slowModeRemainingMs({ lastSendAt: now - 1000 }, 0, now)).toBe(0)
    expect(
      slowModeRemainingMs({ lastSendAt: now - 1000 }, undefined, now),
    ).toBe(0)
  })

  test('is 0 when the user has never sent', () => {
    expect(slowModeRemainingMs({}, 30, now)).toBe(0)
  })

  test('returns the remaining cooldown within the window', () => {
    // Sent 10s ago with a 30s interval -> 20s remaining.
    expect(slowModeRemainingMs({ lastSendAt: now - 10_000 }, 30, now)).toBe(
      20_000,
    )
  })

  test('is 0 once the interval has fully elapsed', () => {
    expect(slowModeRemainingMs({ lastSendAt: now - 31_000 }, 30, now)).toBe(0)
  })
})
