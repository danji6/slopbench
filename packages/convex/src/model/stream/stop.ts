import { internal } from '../../_generated/api'
import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { scheduleTitle } from '../messages'

/** Converts a timed seam stop request into normal stopped stream finalization. */
export async function honorSoftStop(ctx: MutationCtx, stream: Doc<'streams'>) {
  if (!stream.stopAt) return false
  if (stream.status === 'stopping') return true

  await ctx.db.patch(stream._id, {
    status: 'stopping',
    suppressFollowUp: true,
  })
  await ctx.scheduler.runAfter(0, internal.streams._finalizeStopped, {
    streamId: stream._id,
  })
  return true
}

/** Requests an immediate stop when no provider/tool step is currently running. */
export async function requestImmediateStop(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  options?: { suppressReport?: boolean },
) {
  if (stream.jobId) await ctx.scheduler.cancel(stream.jobId)

  if (!stream.processingMessageId) {
    await ctx.db.delete(stream._id)
    await scheduleTitle(ctx, stream.sessionId)
    await ctx.scheduler.runAfter(0, internal.chat._drainCommandQueue, {
      sessionId: stream.sessionId,
    })
    return 'deleted' as const
  }

  await ctx.db.patch(stream._id, {
    status: 'stopping',
    suppressFollowUp: true,
    ...(options?.suppressReport ? { suppressReport: true } : {}),
  })
  await ctx.scheduler.runAfter(0, internal.streams._finalizeStopped, {
    streamId: stream._id,
  })
  return 'finalizing' as const
}
