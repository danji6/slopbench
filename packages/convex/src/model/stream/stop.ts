import { internal } from '../../_generated/api'
import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { scheduleTitle } from '../messages'
import { settleStream } from '../notificationRequests'
import { cancelScheduledExecution } from './execution'

type StopOptions = { suppressReport?: boolean }

/** Cancels scheduled work and transfers settlement to the stopped finalizer. */
export async function stopExecution(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  options?: StopOptions,
) {
  if (stream.state.phase === 'stopping') {
    if (options?.suppressReport && !stream.suppressReport) {
      await ctx.db.patch(stream._id, { suppressReport: true })
    }
    return
  }

  await settleStream(ctx, stream._id, 'cancelled')
  await cancelScheduledExecution(ctx, stream)

  const retryError =
    stream.state.phase === 'retrying' ? stream.state.retryError : undefined

  await ctx.db.patch(stream._id, {
    state: {
      phase: 'stopping',
      processingMessageId: stream.state.processingMessageId,
      processingContentId: stream.state.processingContentId,
      retryError,
    },
    suppressFollowUp: true,
    ...(options?.suppressReport ? { suppressReport: true } : {}),
  })

  await ctx.scheduler.runAfter(0, internal.streams._finalizeStopped, {
    streamId: stream._id,
  })
}

/** Converts a timed seam stop request into normal stopped stream finalization. */
export async function honorSoftStop(ctx: MutationCtx, stream: Doc<'streams'>) {
  if (stream.state.phase === 'stopping') return true
  if (!stream.stopAt) return false
  await stopExecution(ctx, stream)
  return true
}

/** Requests an immediate stop when no provider/tool step is currently running. */
export async function requestImmediateStop(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  options?: StopOptions,
) {
  if (stream.state.phase === 'stopping') return 'finalizing' as const
  if (!stream.state.processingMessageId) {
    await settleStream(ctx, stream._id, 'cancelled')
    await cancelScheduledExecution(ctx, stream)
    await ctx.db.delete(stream._id)
    await scheduleTitle(ctx, stream.sessionId)
    await ctx.scheduler.runAfter(0, internal.chat._drainCommandQueue, {
      sessionId: stream.sessionId,
    })
    return 'deleted' as const
  }
  await stopExecution(ctx, stream, options)
  return 'finalizing' as const
}
