import { mcpDefinitionSchema } from '@sb/core/types/mcp-catalog'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { ToolError } from '../../errors'
import type { StreamExecutionArgs } from '../../types'

/** Reads a complete definition only after its owning catalog target was authorized. */
export async function loadMcpDefinition(
  ctx: ActionCtx,
  reference: string,
  execution: StreamExecutionArgs,
) {
  await ctx.runQuery(internal.mcpCatalogs._definitionAccess, {
    ...execution,
    definitionRef: reference as Id<'_storage'>,
  })
  const blob = await ctx.storage.get(reference as Id<'_storage'>)
  if (!blob)
    throw new ToolError('MCP definition unavailable; refresh this catalog')
  return mcpDefinitionSchema.parse(JSON.parse(await blob.text()))
}
