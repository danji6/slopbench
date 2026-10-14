import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { AuthMutationCtx } from '../../functions'
import { removeForSession as removeSessionCache } from '../session/cache'
import * as Memberships from '../session/memberships'
import { scheduleStream } from '../stream/execution'
import { requestImmediateStop } from '../stream/stop'
import { handleStreamEnd } from './scheduling'

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

  const result = await requestImmediateStop(ctx, stream, {
    // A sub-agent stopped by the user may have nothing to report back
    suppressReport: Boolean(session.parent),
  })
  if (result === 'deleted') {
    await handleStreamEnd(ctx, stream, 'stopped')
  }
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
  if (!stream || stream.state.phase !== 'retrying') return

  await scheduleStream(ctx, stream._id, { resetAttempt: true })
}
