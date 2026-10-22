'use node'

import { mcpConnectionSchema } from '@sb/core/types'
import { mcpProtocolRequestSchema } from '@sb/core/types/mcp-protocol'
import { MAX_MCP_RESULT_BYTES } from '@sb/core/types/mcp-result'

import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import type { McpProtocolRequestArgs } from '../types'
import { externalRequest } from './tool/mcp'

/** Checks the saved server in an isolated probe and retains a bounded temporary artifact. */
export async function checkProtocol(
  ctx: ActionCtx,
  args: McpProtocolRequestArgs,
): Promise<Id<'mcpProtocolChecks'>> {
  const server = await ctx.runQuery(internal.mcpProtocol._launch, {
    serverId: args.serverId,
  })
  const request = mcpProtocolRequestSchema.parse(args)

  const result = await externalRequest(
    '/mcp-ext/protocol/probe',
    {
      connection: mcpConnectionSchema.parse(server),
      request,
    },
    AbortSignal.timeout(65_000),
  )

  const blob = new Blob([JSON.stringify(result)], { type: 'application/json' })
  if (blob.size > MAX_MCP_RESULT_BYTES + 128 * 1024)
    throw new Error('MCP check artifact exceeds capacity')

  const resultRef = await ctx.storage.store(blob)
  try {
    return await ctx.runMutation(internal.mcpProtocol._publish, {
      serverId: args.serverId,
      revision: server.revision ?? 0,
      resultRef,
      bytes: blob.size,
    })
  } catch (error) {
    const retained = await ctx.runQuery(internal.mcpProtocol._reference, {
      resultRef,
    })
    if (!retained) await ctx.storage.delete(resultRef)
    throw error
  }
}
