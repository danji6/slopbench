/// <reference types="bun-types" />
import { parseDurationMs } from '@sb/core/utils/duration'
import { describe, expect, test } from 'bun:test'

describe('parseDurationMs', () => {
  test('treats bare values as seconds and expands supported units', () => {
    expect(parseDurationMs('60')).toBe(60_000)
    expect(parseDurationMs('60s')).toBe(60_000)
    expect(parseDurationMs('1m')).toBe(60_000)
    expect(parseDurationMs('1H')).toBe(3_600_000)
    expect(parseDurationMs(' .5 m ')).toBe(30_000)
    expect(parseDurationMs('0')).toBe(0)
  })

  test('rejects unsupported or ambiguous forms', () => {
    for (const value of ['', '-1', '1d', '1m30s', 'Infinity', '1e3']) {
      expect(() => parseDurationMs(value)).toThrow('Invalid duration')
    }
  })
})
