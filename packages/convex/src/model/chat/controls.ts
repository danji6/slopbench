import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { AuthMutationCtx } from '../../functions'
import { scheduleTitle } from '../messages'
import { removeForSession as removeSessionCache } from '../session/cache'
import * as Memberships from '../session/memberships'
import { STREAM_LEASE_MS } from '../stream/lifecycle'

export async function stopStream(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const { session } = await Memberships.requireMember(
    ctx,
    sessionId,
    ctx.userId,
  )

  const stream = await Memberships.getActiveStream(ctx, sessionId)
  if (!stream) return

  if (stream.jobId) await ctx.scheduler.cancel(stream.jobId)

  // An aborted turn has nothing to finalize. Drop the stream and schedule the title.
  if (!stream.processingMessageId) {
    await ctx.db.delete(stream._id)
    await scheduleTitle(ctx, stream.sessionId)
    await ctx.scheduler.runAfter(0, internal.chat._drainCommandQueue, {
      sessionId: stream.sessionId,
    })
    return
  }

  await ctx.db.patch(stream._id, {
    status: 'stopping',
    suppressFollowUp: true,
    // A sub-agent stopped by the user may have nothing to report back
    ...(session.parent ? { suppressReport: true } : {}),
  })
  await ctx.scheduler.runAfter(0, internal.streams._finalizeStopped, {
    streamId: stream._id,
  })
}

/**
 * Drops the session's cached prompts and tool manifest, forcing both to be
 * recomputed on the next invocation.
 */
export async function executeEval(ctx: MutationCtx, session: Doc<'sessions'>) {
  await removeSessionCache(ctx, session._id)
}

export async function retryStreamNow(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  await Memberships.requireMember(ctx, sessionId, ctx.userId)

  const stream = await Memberships.getActiveStream(ctx, sessionId)
  if (!stream || stream.status !== 'retrying') return

  if (stream.jobId) await ctx.scheduler.cancel(stream.jobId)

  const jobId = await ctx.scheduler.runAfter(
    0,
    internal.actions.streams._stream,
    { streamId: stream._id },
  )

  await ctx.db.patch(stream._id, {
    status: 'pending',
    attempt: 0,
    retryAt: undefined,
    retryError: undefined,
    jobId,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
  })
}
