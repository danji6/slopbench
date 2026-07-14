import { useQuery } from 'convex/react'
import type { FunctionReference, FunctionReturnType } from 'convex/server'
import { useEffect, useSyncExternalStore } from 'react'

type UrlMapQuery = FunctionReference<
  'query',
  'public',
  { ids: string[] },
  Record<string, unknown>
>

export function createMediaUrlStore<Q extends UrlMapQuery>(query: Q) {
  type Value = FunctionReturnType<Q>[string]

  const requested = new Set<string>()
  let idsSnapshot: string[] = []
  const idListeners = new Set<() => void>()

  let cache: Record<string, Value> = {}
  const cacheListeners = new Set<() => void>()

  function subscribeIds(listener: () => void) {
    idListeners.add(listener)
    return () => idListeners.delete(listener)
  }

  function subscribeCache(listener: () => void) {
    cacheListeners.add(listener)
    return () => cacheListeners.delete(listener)
  }

  function register(ids: (string | undefined)[]) {
    let changed = false
    for (const id of ids) {
      if (id && !requested.has(id)) {
        requested.add(id)
        changed = true
      }
    }
    if (!changed) return
    idsSnapshot = [...requested]
    idListeners.forEach((listener) => listener())
  }

  function merge(next: Record<string, Value>) {
    cache = { ...cache, ...next }
    cacheListeners.forEach((listener) => listener())
  }

  function Provider() {
    const ids = useSyncExternalStore(
      subscribeIds,
      () => idsSnapshot,
      () => idsSnapshot,
    )
    const result = useQuery(
      query as unknown as UrlMapQuery,
      ids.length ? { ids } : 'skip',
    )
    useEffect(() => {
      if (result) merge(result as Record<string, Value>)
    }, [result])
    return null
  }

  function useMediaUrls(): Record<string, Value> {
    return useSyncExternalStore(
      subscribeCache,
      () => cache,
      () => cache,
    )
  }

  function useMediaUrl(id?: string): Value | undefined {
    useEffect(() => {
      if (id) register([id])
    }, [id])
    return useMediaUrls()[id ?? ''] as Value | undefined
  }

  return { Provider, useMediaUrl, useMediaUrls, register }
}
