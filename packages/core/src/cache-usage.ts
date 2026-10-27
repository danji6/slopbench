import type { LanguageModelUsage } from 'ai'

export type CacheUsage = {
  readTokens: number
  /** Input tokens from requests that reported cache usage. */
  inputTokens: number
}

/**
 * Reads normalized SDK counts: input includes reads and writes; absent reads mean
 * unreported usage. Map custom provider fields at the inference adapter boundary.
 */
export function resolveCacheUsage(
  usage: LanguageModelUsage | undefined,
): CacheUsage | undefined {
  const inputTokens = usage?.inputTokens
  const readTokens = usage?.inputTokenDetails?.cacheReadTokens
  if (inputTokens == null || readTokens == null) return undefined

  const countsInRange =
    Number.isFinite(inputTokens) &&
    Number.isFinite(readTokens) &&
    inputTokens >= 0 &&
    readTokens >= 0 &&
    readTokens <= inputTokens
  if (!countsInRange) return undefined

  return { readTokens, inputTokens }
}

/** Combines measured counts without including requests that lack cache reporting. */
export function addCacheUsage(
  previous: CacheUsage | undefined,
  next: CacheUsage | undefined,
): CacheUsage | undefined {
  if (!previous) return next
  if (!next) return previous
  return {
    readTokens: previous.readTokens + next.readTokens,
    inputTokens: previous.inputTokens + next.inputTokens,
  }
}

/** Returns the percentage of measured input tokens served from cache. */
export function cacheHitRate(usage: CacheUsage | undefined) {
  if (!usage || usage.inputTokens <= 0) return undefined
  return (usage.readTokens / usage.inputTokens) * 100
}
