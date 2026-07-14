'use node'

import { v } from 'convex/values'

import { action } from '../_generated/server'
import { error } from '../errors'
import type { McpToolMeta } from '../types'
import { mcpTransportValidator } from '../validators/sub'

const DEFAULT_SIDECAR_URL = 'http://localhost:3212'

/** Discovers and caches MCP tools for a given server. */
export const discoverMcpTools = action({
  args: {
    url: v.string(),
    transport: mcpTransportValidator,
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ tools: McpToolMeta[] }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) error('Unauthorized', 401)

    const base = process.env.SIDECAR_URL ?? DEFAULT_SIDECAR_URL
    const response = await fetch(new URL('/mcp-ext/list', base).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })

    const data = (await response.json()) as {
      tools?: McpToolMeta[]
      error?: string
    }
    if (!response.ok || data.error) {
      error(data.error ?? `Discovery failed with HTTP ${response.status}`, 502)
    }
    return { tools: data.tools ?? [] }
  },
})
