import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type {
  SaveStreamCacheArgs,
  SaveStreamEnvironmentArgs,
  SaveStreamLogArgs,
} from '../../types'
import type { SaveStreamMetaArgs } from '../../types'
import type { TokenUsage } from '../../types'
import { getProcessingSegmentRow, saveSegmentMeta } from '../messageContents'
import { _save } from '../session/cache'
import { _patchSessionLog } from '../session/sessionWorkspace'
import { getState, patchState } from '../session/state'
import { ownsExecution } from './execution'

export async function _saveMeta(
  ctx: MutationCtx,
  {
    streamId,
    generation,
    duration,
    toolErrors,
    warnings,
    usage,
  }: SaveStreamMetaArgs,
) {
  const stream = await ctx.db.get(streamId)
  if (!ownsExecution(stream, { streamId, generation })) return

  const row = await getProcessingSegmentRow(ctx, stream)
  if (row && stream.processingMessageId) {
    // Accumulate step deltas into the segment's slice and the turn total
    const message = await ctx.db.get(stream.processingMessageId)
    const delta = { duration, toolErrors, warnings, usage }
    await saveSegmentMeta(ctx, {
      row,
      messageId: stream.processingMessageId,
      rowMetadata: accumulateMeta(row.metadata, delta),
      docMetadata: accumulateMeta(message?.metadata, delta),
    })
  }

  await accumulateSessionUsage(ctx, stream.sessionId, usage)
}

export type MetaDelta = {
  duration: number
  toolErrors: string[]
  warnings: string[]
  usage: TokenUsage
}

export function accumulateMeta(
  prev: Doc<'messages'>['metadata'],
  delta: MetaDelta,
): Doc<'messages'>['metadata'] {
  return {
    ...prev,
    duration: (prev?.duration ?? 0) + delta.duration,
    toolErrors: [
      ...new Set([...(prev?.toolErrors ?? []), ...delta.toolErrors]),
    ],
    warnings: [...new Set([...(prev?.warnings ?? []), ...delta.warnings])],
    usage: delta.usage,
  }
}

export async function accumulateSessionUsage(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  delta: TokenUsage,
) {
  const prev = (await getState(ctx, sessionId))?.usage ?? {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  }

  await patchState(ctx, sessionId, {
    usage: {
      inputTokens: prev.inputTokens + delta.inputTokens,
      outputTokens: prev.outputTokens + delta.outputTokens,
      totalTokens: prev.totalTokens + delta.totalTokens,
    },
  })
}

export async function saveCache(ctx: MutationCtx, args: SaveStreamCacheArgs) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return null
  if (stream.sessionId !== args.sessionId || stream.agentId !== args.agentId)
    return null
  const { streamId: _streamId, generation: _generation, ...cache } = args
  return _save(ctx, cache)
}

export async function saveEnvironment(
  ctx: MutationCtx,
  args: SaveStreamEnvironmentArgs,
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return
  await patchState(ctx, stream.sessionId, { environment: args.environment })
}

export async function saveLog(ctx: MutationCtx, args: SaveStreamLogArgs) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) {
    await ctx.storage.delete(args.storageId)
    return false
  }
  await _patchSessionLog(ctx, {
    sessionId: stream.sessionId,
    storageId: args.storageId,
  })
  return true
}
