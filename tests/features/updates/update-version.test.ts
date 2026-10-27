/// <reference types="bun-types" />
import {
  compareVersions,
  isNewer,
  normalizeVersion,
  parseVersion,
} from '@sb/core/update/version'
import { describe, expect, test } from 'bun:test'

describe('parseVersion', () => {
  test('accepts tags and bare versions alike', () => {
    expect(parseVersion('v1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    })
    expect(parseVersion(' 0.1.0 ')?.minor).toBe(1)
    expect(parseVersion('1.2.3-beta.1')?.prerelease).toEqual(['beta', '1'])
    expect(parseVersion('1.2.3+build.5')?.prerelease).toEqual([])
  })

  test('rejects anything that is not a version', () => {
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('compareVersions', () => {
  test('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1)
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  test('ranks a prerelease below its own release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1)
    expect(compareVersions('1.0.0-beta', '1.0.0-beta.1')).toBe(-1)
  })
})

describe('isNewer', () => {
  test('only reports a strictly newer version', () => {
    expect(isNewer('0.1.0', '0.2.0')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.3.0', '0.2.0')).toBe(false)
  })

  // An unparseable version must never trigger an update: a source checkout
  // reporting something odd would otherwise swap its own tree.
  test('refuses to compare versions it cannot parse', () => {
    expect(isNewer('unknown', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', 'nightly')).toBe(false)
  })
})

describe('normalizeVersion', () => {
  test('drops a leading v', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3')
    expect(normalizeVersion('1.2.3')).toBe('1.2.3')
  })
})
