import { MCP_DEFINITION_CONTENT_TYPE } from '@sb/core/types/mcp-catalog'

import { internal } from '../_generated/api'
import type { MutationCtx } from '../_generated/server'
import type { McpCatalogSweepArgs } from '../types'

/** Reclaims uploads interrupted between blob storage and their catalog-row transaction. */
export async function sweepOrphanDefinitions(
  ctx: MutationCtx,
  args: McpCatalogSweepArgs,
) {
  const before = args.before ?? Date.now() - 60 * 60_000
  const result = await ctx.db.system.query('_storage').paginate({
    cursor: args.cursor ?? null,
    numItems: 64,
    maximumRowsRead: 256,
  })

  for (const row of result.page) {
    if (row._creationTime >= before) continue
    if (row.contentType !== MCP_DEFINITION_CONTENT_TYPE) continue
    const reference = await ctx.db
      .query('mcpCatalogTools')
      .withIndex('by_definitionRef', (q) => q.eq('definitionRef', row._id))
      .unique()
    if (!reference) await ctx.storage.delete(row._id)
  }

  const reachedFreshUploads = result.page.some(
    (row) => row._creationTime >= before,
  )

  if (!result.isDone && !reachedFreshUploads) {
    await ctx.scheduler.runAfter(0, internal.mcpCatalogs._sweepOrphans, {
      before,
      cursor: result.continueCursor,
    })
  }
}
