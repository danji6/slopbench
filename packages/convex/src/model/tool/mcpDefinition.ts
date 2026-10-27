import {
  type McpDefinition,
  mcpDefinitionSchema,
} from '@sb/core/types/mcp-catalog'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { ToolError } from '../../errors'
import type { StreamExecutionArgs } from '../../types'

type DefinitionTarget = Pick<
  Doc<'mcpCatalogTools'>,
  'catalogId' | 'definitionRef' | 'bytes'
>

type CacheEntry = { value: Promise<McpDefinition>; bytes: number }

const MAX_CACHE_ENTRIES = 16
const MAX_CACHE_BYTES = 8 * 1024 * 1024

/** Reuses immutable catalog blobs within an execution, without caching authorization. */
export function createMcpDefinitionReader(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
) {
  const cache = new Map<string, CacheEntry>()
  return async (target: DefinitionTarget) => {
    await authorizeDefinition(ctx, target.definitionRef, execution)
    const key = `${target.catalogId}:${target.definitionRef}`
    const cached = cache.get(key)
    if (cached) return cached.value

    const value = readDefinition(ctx, target.definitionRef)
    rememberDefinition(cache, key, { value, bytes: target.bytes })
    return value
  }
}

function rememberDefinition(
  cache: Map<string, CacheEntry>,
  key: string,
  entry: CacheEntry,
) {
  if (entry.bytes > MAX_CACHE_BYTES) return
  let bytes = [...cache.values()].reduce((sum, row) => sum + row.bytes, 0)

  while (cache.size) {
    const entryLimitReached = cache.size >= MAX_CACHE_ENTRIES
    const byteLimitReached = bytes + entry.bytes > MAX_CACHE_BYTES
    if (!entryLimitReached && !byteLimitReached) break
    const oldest = cache.entries().next().value!
    bytes -= oldest[1].bytes
    cache.delete(oldest[0])
  }
  cache.set(key, entry)
  void entry.value.catch(() => {
    if (cache.get(key) === entry) cache.delete(key)
  })
}

/** Reads a complete definition only after its owning catalog target was authorized. */
export async function loadMcpDefinition(
  ctx: ActionCtx,
  reference: string,
  execution: StreamExecutionArgs,
) {
  await authorizeDefinition(ctx, reference, execution)
  return readDefinition(ctx, reference)
}

async function authorizeDefinition(
  ctx: ActionCtx,
  reference: string,
  execution: StreamExecutionArgs,
) {
  await ctx.runQuery(internal.mcpCatalogs._definitionAccess, {
    ...execution,
    definitionRef: reference as Id<'_storage'>,
  })
}

async function readDefinition(ctx: ActionCtx, reference: string) {
  const blob = await ctx.storage.get(reference as Id<'_storage'>)
  if (!blob)
    throw new ToolError('MCP definition unavailable; refresh this catalog')
  return mcpDefinitionSchema.parse(JSON.parse(await blob.text()))
}
