import { ShikiWorker, type ShikiWorkerApi } from '@/workers'
import type { WorkerApi } from '@/workers'

import { isClient } from '../utils'
import { runDiffHighlighter, runHighlighter } from './core'

let worker: WorkerApi<ShikiWorkerApi> | null = null

function getWorker(): WorkerApi<ShikiWorkerApi> {
  if (!worker) worker = ShikiWorker()
  return worker
}

const MAX_CACHE_ENTRIES = 500
const cache = new Map<string, string>()

/** Synchronously returns a previously highlighted result, if any. */
export function getCachedHighlight(
  code: string,
  lang?: string,
  diff: boolean = false,
): string | null {
  return cache.get(cacheKey(code, lang, diff)) ?? null
}

/** Main highlighter function. Attempts to use a worker if possible. */
export async function highlight(code: string, lang: string = 'typescript') {
  const key = cacheKey(code, lang, false)
  const cached = cache.get(key)
  if (cached) return cached

  const result = isClient
    ? await getWorker().api.highlight(code, lang)
    : await runHighlighter(code, lang)
  setCached(key, result)
  return result
}

export async function highlightDiff(diff: string, lang?: string) {
  const key = cacheKey(diff, lang, true)
  const cached = cache.get(key)
  if (cached) return cached

  const result = isClient
    ? await getWorker().api.highlightDiff(diff, lang)
    : await runDiffHighlighter(diff, lang)
  setCached(key, result)
  return result
}

function cacheKey(code: string, lang: string | undefined, diff: boolean) {
  return `${diff ? 'd' : 'c'}\0${lang ?? ''}\0${code}`
}

function setCached(key: string, value: string) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}
