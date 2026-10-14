import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { TrackStreamOutputArgs } from '../../types'
import { allVersionParts } from '../messageContents'
import { cancelScheduledExecution, ownsExecution } from './execution'
import { expireStream } from './expiry'
import { discardStream } from './lifecycleTerminal'
import { collectToolOutputStorageIds } from './toolOutput'

export const ORPHAN_OUTPUT_TTL_MS = 24 * 60 * 60 * 1000

export async function _trackOffloadedOutput(
  ctx: MutationCtx,
  { streamId, generation, messageId, storageId }: TrackStreamOutputArgs,
) {
  const stream = await ctx.db.get(streamId)
  if (!ownsExecution(stream, { streamId, generation })) {
    await ctx.storage.delete(storageId)
    return false
  }
  await ctx.db.insert('offloadedOutputs', { streamId, messageId, storageId })
  return true
}

/** Deletes tool output blobs that didn't make it into the final message. */
export async function cleanUpOffloadedOutputs(
  ctx: MutationCtx,
  streamId: Id<'streams'>,
) {
  const rows = await ctx.db
    .query('offloadedOutputs')
    .withIndex('by_streamId', (q) => q.eq('streamId', streamId))
    .collect()
  if (rows.length === 0) return

  const validByMessage = new Map<Id<'messages'>, Set<Id<'_storage'>>>()
  for (const row of rows) {
    if (validByMessage.has(row.messageId)) continue
    validByMessage.set(
      row.messageId,
      new Set(
        collectToolOutputStorageIds(await allVersionParts(ctx, row.messageId)),
      ),
    )
  }

  for (const row of rows) {
    if (!validByMessage.get(row.messageId)?.has(row.storageId)) {
      await ctx.storage.delete(row.storageId).catch(() => {})
    }
    await ctx.db.delete(row._id)
  }
}

export async function pruneOrphanedOutputs(ctx: MutationCtx) {
  const cutoff = Date.now() - ORPHAN_OUTPUT_TTL_MS
  const rows = await ctx.db.query('offloadedOutputs').collect()

  for (const row of rows) {
    if (row._creationTime >= cutoff) continue
    // Leave rows for streams that are still running
    if (await ctx.db.get(row.streamId)) continue

    const valid = new Set(
      collectToolOutputStorageIds(await allVersionParts(ctx, row.messageId)),
    )
    if (!valid.has(row.storageId)) {
      await ctx.storage.delete(row.storageId).catch(() => {})
    }
    await ctx.db.delete(row._id)
  }
}

export async function _prune(ctx: MutationCtx) {
  const streams = await ctx.db
    .query('streams')
    .withIndex('by_leaseExpiresAt', (q) => q.lt('leaseExpiresAt', Date.now()))
    .collect()

  for (const stream of streams) {
    await expireStream(ctx, stream)
  }
}

export async function remove(ctx: MutationCtx, streamId: Id<'streams'>) {
  const stream = await ctx.db.get(streamId)
  if (!stream) return
  await cancelScheduledExecution(ctx, stream)
  await discardStream(ctx, streamId)
}
