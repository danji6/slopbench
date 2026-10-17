import {
  DISCOVERY_MAX_MODELS,
  type DiscoveredModel,
  type DiscoveryConnection,
} from '@sb/core/model-discovery'
import { parseProviderExtraHeaders } from '@sb/core/provider-headers'

import { discoveryAdapter } from './discovery/factory'

export class DiscoveryError extends Error {
  constructor(
    public status: number,
    public retryAfter?: number,
  ) {
    super(
      `Model discovery failed (HTTP ${status}). Check the connection and retry.`,
    )
  }
}

/** Fetches a complete catalog; partial responses never replace the cache. */
export async function discoverModels(
  connection: DiscoveryConnection,
  request: typeof fetch = fetch,
): Promise<DiscoveredModel[]> {
  const adapter = discoveryAdapter(connection)
  const first = new URL(adapter.first(connection))
  const headers = {
    ...parseProviderExtraHeaders(connection.extraHeaders),
    ...adapter.headers(connection),
  }
  const deadline = AbortSignal.timeout(90_000)
  const models = new Map<string, DiscoveredModel>()
  const visited = new Set<string>()

  let next: string | undefined = first.href
  while (next) {
    const url: URL = new URL(next, first)
    const endpointChanged =
      url.origin !== first.origin || url.pathname !== first.pathname
    if (endpointChanged) {
      throw new Error('Unsafe model catalog pagination')
    }
    if (url.username || url.password) {
      throw new Error('Unsafe model catalog pagination')
    }
    if (visited.has(url.href) || visited.size >= 100)
      throw new Error('Invalid model catalog pagination')

    visited.add(url.href)

    const response = await request(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.any([deadline, AbortSignal.timeout(30_000)]),
    })
    if (!response.ok) throw discoveryFailure(response)

    const page = adapter.page(await response.json(), url)
    for (const model of page.models) {
      if (!models.has(model.id)) models.set(model.id, model)
      if (models.size > DISCOVERY_MAX_MODELS)
        throw new Error('The provider catalog exceeds the discovery limit')
    }
    next = page.next
  }

  return [...models.values()]
}

function discoveryFailure(response: Response) {
  const value = response.headers.get('retry-after')
  const seconds = Number(value)
  const retryAfter = value
    ? Number.isFinite(seconds)
      ? Date.now() + seconds * 1000
      : Date.parse(value)
    : undefined
  return new DiscoveryError(
    response.status,
    retryAfter && Number.isFinite(retryAfter) ? retryAfter : undefined,
  )
}
