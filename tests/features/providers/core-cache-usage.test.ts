import {
  addCacheUsage,
  cacheHitRate,
  resolveCacheUsage,
} from '@sb/core/cache-usage'
import type { LanguageModelUsage } from 'ai'
import { describe, expect, test } from 'bun:test'

function usage(
  inputTokens = 1000,
  cacheReadTokens?: number,
): LanguageModelUsage {
  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens,
      cacheWriteTokens: 100,
    },
    outputTokens: 20,
    outputTokenDetails: { textTokens: 20, reasoningTokens: undefined },
    totalTokens: inputTokens + 20,
  }
}

describe('cache usage contract', () => {
  test('accepts normalized cache reporting from any provider and excludes writes from hits', () => {
    const cache = resolveCacheUsage(usage(1000, 400))
    expect(cache).toEqual({ readTokens: 400, inputTokens: 1000 })
    expect(cacheHitRate(cache)).toBe(40)
  })

  test('distinguishes a measured miss from missing reporting', () => {
    expect(cacheHitRate(resolveCacheUsage(usage(1000, 0)))).toBe(0)
    expect(resolveCacheUsage(usage())).toBeUndefined()
    expect(resolveCacheUsage(undefined)).toBeUndefined()
    expect(cacheHitRate(undefined)).toBeUndefined()
    expect(cacheHitRate(resolveCacheUsage(usage(0, 0)))).toBeUndefined()
  })

  test.each([-1, 1001, Infinity, NaN])(
    'ignores invalid cache token counts: %s',
    (count) => {
      expect(resolveCacheUsage(usage(1000, count))).toBeUndefined()
    },
  )

  test('weights rates by measured input tokens', () => {
    const first = resolveCacheUsage(usage(1000, 800))
    const second = resolveCacheUsage(usage(3000, 0))
    const cumulative = addCacheUsage(addCacheUsage(undefined, first), second)
    expect(cacheHitRate(cumulative)).toBe(20)
    expect(addCacheUsage(cumulative, undefined)).toEqual(cumulative)
    expect(addCacheUsage(undefined, undefined)).toBeUndefined()
  })
})
