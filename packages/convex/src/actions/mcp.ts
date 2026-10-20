'use node'

import { action, internalAction } from '../_generated/server'
import * as V from '../validators/mcp'

export const discoverMcpTools = action({
  args: V.discoverMcpToolsArgsValidator.fields,
  handler: async (ctx, args) => {
    const { discoverMcpTools } = await import('../model/mcpDiscoveryAction')
    return discoverMcpTools(ctx, args)
  },
})

export const _cleanup = internalAction({
  args: V.mcpCleanupArgsValidator.fields,
  handler: async (ctx, args) => {
    const { cleanup } = await import('../model/mcpRuntimeActions')
    await cleanup(ctx, args)
  },
})

export const _reconcile = internalAction({
  args: {},
  handler: async (ctx) => {
    const { reconcile } = await import('../model/mcpRuntimeActions')
    await reconcile(ctx)
  },
})

export const runtimeStatus = action({
  args: V.mcpRuntimeArgsValidator.fields,
  handler: async (ctx, args) => {
    const { runtimeStatus } = await import('../model/mcpRuntimeActions')
    return runtimeStatus(ctx, args)
  },
})
