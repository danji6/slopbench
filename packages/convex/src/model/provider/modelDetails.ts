import { discoveryFingerprint } from '@sb/core/discovery-fingerprint'
import type {
  DiscoveredModel,
  DiscoveryConnection,
} from '@sb/core/model-discovery'

import { discoveryAdapter } from './discovery/factory'

let active = 0
const queue: (() => void)[] = []
const pending = new Map<string, Promise<DiscoveredModel>>()

/** Bounds optional metadata calls and deduplicates concurrent selections. */
export async function fetchModelDetails(
  connection: DiscoveryConnection,
  model: DiscoveredModel,
): Promise<DiscoveredModel> {
  if (model.detailsLoaded) return model

  const details = discoveryAdapter(connection).details
  if (!details) return model

  const key = JSON.stringify([
    await discoveryFingerprint(connection),
    model.id,
    model.detailKey,
  ])

  const existing = pending.get(key)
  if (existing) return existing

  const result = (async () => {
    if (active >= 2) await new Promise<void>((resolve) => queue.push(resolve))
    else active++
    try {
      return await details(connection, model, fetch)
    } finally {
      const next = queue.shift()
      if (next) next()
      else active--
      pending.delete(key)
    }
  })()

  pending.set(key, result)
  return result
}
