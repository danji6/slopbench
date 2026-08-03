'use node'

import { api, internal } from '../_generated/api'
import { action } from '../_generated/server'
import { error } from '../errors'
import type { McpDialedTransport, McpToolMeta } from '../types'
import * as V from '../validators/args'

const DEFAULT_SIDECAR_URL = 'http://localhost:3212'

/** Performs a stateless tool discovery on the given server. */
export const discoverMcpTools = action({
  args: V.discoverMcpToolsArgsValidator.fields,
  handler: async (
    ctx,
    { url, transport, apiKey, serverId },
  ): Promise<{ tools: McpToolMeta[]; transport?: McpDialedTransport }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) error('Unauthorized', 401)

    let key = apiKey
    if (key === undefined && serverId) {
      await ctx.runQuery(api.mcp.get, { serverId })
      key = (await ctx.runQuery(internal.mcp._getApiKey, { serverId })) ?? undefined // prettier-ignore
    }

    const base = process.env.SIDECAR_URL ?? DEFAULT_SIDECAR_URL
    const response = await fetch(new URL('/mcp-ext/list', base).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, transport, apiKey: key }),
    })

    const data = (await response.json()) as {
      tools?: McpToolMeta[]
      transport?: McpDialedTransport
      error?: string
    }
    if (!response.ok || data.error) {
      error(data.error ?? `Discovery failed with HTTP ${response.status}`, 502)
    }

    const { clampMcpTools } = await import('@sb/core/types')

    return { tools: clampMcpTools(data.tools ?? []), transport: data.transport }
  },
})
