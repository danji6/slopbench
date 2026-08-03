import { api } from '@sb/convex/_generated/api'
import type { McpServerView } from '@sb/convex/model/mcp'
import type { ModelProviderView } from '@sb/convex/model/providers'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useAction, useMutation } from 'convex/react'

export function useMcpServers(): McpServerView[] | undefined {
  return useQuery(api.mcp.list, {})
}

export function useMcpServersSave() {
  return useMutation(api.mcp.replaceAll)
}

export function useModelProviders(): ModelProviderView[] | undefined {
  return useQuery(api.providers.list, {})
}

export function useModelProvidersSave() {
  return useMutation(api.providers.replaceAll)
}

/** Reads a server's tools without storing them. */
export function useMcpToolDiscovery() {
  return useAction(api.actions.mcp.discoverMcpTools)
}
