import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { TokenUsage } from '../../types'
import { getProcessingSegmentRow, saveSegmentMeta } from '../messageContents'
import { getState, patchState } from '../session/state'

export async function _saveMeta(
  ctx: MutationCtx,
  {
    streamId,
    duration,
    toolErrors,
    warnings,
    usage,
  }: {
    streamId: Id<'streams'>
    duration: number
    toolErrors: string[]
    warnings: string[]
    usage: TokenUsage
  },
) {
  const stream = await ctx.db.get(streamId)
  if (!stream) return

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
