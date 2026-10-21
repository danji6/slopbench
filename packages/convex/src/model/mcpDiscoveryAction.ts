'use node'

import { mcpConnectionSchema, validateMcpTools } from '@sb/core/types'
import type {
  McpConnection,
  McpDialedTransport,
  McpToolMeta,
} from '@sb/core/types'

import { api } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import { error } from '../errors'
import { authorizeAdmin } from '../functions'
import type { DiscoverMcpToolsArgs } from '../types'
import { refreshSavedCatalog } from './mcpCatalogActions'
import { sidecarUrl } from './sidecar'
import { sidecarRequest } from './sidecarTransport'

type DiscoveryResult = {
  tools: McpToolMeta[]
  transport?: McpDialedTransport
  catalogId?: string
  count?: number
}

type DiscoveryResponse = Partial<DiscoveryResult> & { error?: string }

/** Discovers tools through an explicitly requested, isolated connection probe. */
export async function discoverMcpTools(
  ctx: ActionCtx,
  args: DiscoverMcpToolsArgs,
): Promise<DiscoveryResult> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) error('Unauthorized', 401)
  if (args.transport === 'stdio') await authorizeAdmin(ctx)

  if (args.serverId) {
    await ctx.runQuery(api.mcp.get, { serverId: args.serverId })
    const result = await refreshSavedCatalog(ctx, args.serverId)
    return {
      tools: [],
      ...result,
      transport: result.transport as McpDialedTransport | undefined,
    }
  }

  const connection = mcpConnectionSchema.parse(args)
  const data = await probeTools(connection)

  return {
    tools: validateMcpTools(data.tools ?? []),
    transport: data.transport,
  }
}

async function probeTools(
  connection: McpConnection,
): Promise<DiscoveryResponse> {
  const response = await fetch(
    new URL('/mcp-ext/list', sidecarUrl()).toString(),
    sidecarRequest({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(connection),
    }),
  )

  const data = (await response.json()) as DiscoveryResponse

  if (!response.ok || data.error) {
    error(data.error ?? `Discovery failed with HTTP ${response.status}`, 502)
  }

  return data
}
