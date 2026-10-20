'use node'

import { clampMcpTools, mcpConnectionSchema } from '@sb/core/types'
import type {
  McpConnection,
  McpDialedTransport,
  McpToolMeta,
} from '@sb/core/types'

import { api, internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import { error } from '../errors'
import { authorizeAdmin } from '../functions'
import type { DiscoverMcpToolsArgs } from '../types'
import { sidecarUrl } from './sidecar'
import { sidecarRequest } from './sidecarTransport'

type DiscoveryResult = { tools: McpToolMeta[]; transport?: McpDialedTransport }
type DiscoveryResponse = Partial<DiscoveryResult> & { error?: string }

/** Discovers tools through an explicitly requested, isolated connection probe. */
export async function discoverMcpTools(
  ctx: ActionCtx,
  args: DiscoverMcpToolsArgs,
): Promise<DiscoveryResult> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) error('Unauthorized', 401)
  if (args.transport === 'stdio') await authorizeAdmin(ctx)

  const connection = await discoveryConnection(ctx, args)
  const data = await probeTools(connection)
  return { tools: clampMcpTools(data.tools ?? []), transport: data.transport }
}

async function discoveryConnection(
  ctx: ActionCtx,
  { serverId, apiKey, ...input }: DiscoverMcpToolsArgs,
): Promise<McpConnection> {
  let key = apiKey
  let secretEnv: Record<string, string> | undefined
  if (serverId) {
    await ctx.runQuery(api.mcp.get, { serverId })
    secretEnv = await ctx.runQuery(internal.mcp._getSecretEnv, { serverId })
    key ??=
      (await ctx.runQuery(internal.mcp._getApiKey, { serverId })) ?? undefined
  }
  return mcpConnectionSchema.parse({ ...input, apiKey: key, secretEnv })
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
