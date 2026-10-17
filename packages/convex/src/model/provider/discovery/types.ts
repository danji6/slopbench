import type {
  DiscoveredModel,
  DiscoveryConnection,
} from '@sb/core/model-discovery'

export type DiscoveryPage = { models: DiscoveredModel[]; next?: string }
export type DiscoveryAdapter = {
  details?: (
    connection: DiscoveryConnection,
    model: DiscoveredModel,
    request: typeof fetch,
  ) => Promise<DiscoveredModel>
  first: (connection: DiscoveryConnection) => string
  headers: (connection: DiscoveryConnection) => Record<string, string>
  page: (data: unknown, url: URL) => DiscoveryPage
}
