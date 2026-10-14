import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { sharedSessionId } from '../../lib/subagent'
import type { ScheduleStreamRetryArgs, StreamExecutionArgs } from '../../types'
import { releaseForSession } from '../shellJobs'
import { scheduleStream } from './execution'
import { ownsExecution } from './execution'
import { honorSoftStop, stopExecution } from './stop'

/** Stops a timed out stream at the seam after its current provider step. */
export async function _honorSoftStop(
  ctx: MutationCtx,
  { streamId, generation }: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(streamId)
  return ownsExecution(stream, { streamId, generation })
    ? honorSoftStop(ctx, stream)
    : true
}

export async function _scheduleRetry(
  ctx: MutationCtx,
  { streamId, generation, retryAt, retryError }: ScheduleStreamRetryArgs,
) {
  const stream = await ctx.db.get(streamId)
  if (!ownsExecution(stream, { streamId, generation })) return
  if (await honorSoftStop(ctx, stream)) return

  await scheduleStream(ctx, streamId, { kind: 'retrying', retryAt, retryError })
}

export async function _omitActiveMedia(
  ctx: MutationCtx,
  { streamId, generation }: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(streamId)
  if (ownsExecution(stream, { streamId, generation })) {
    await ctx.db.patch(streamId, { omitActiveMedia: true })
  }
}

/** Stopping a parent takes its running sub-agent children down with it. */
export async function stopChildSessions(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const children = await ctx.db
    .query('sessions')
    .withIndex('by_parentSessionId', (q) => q.eq('parent.sessionId', sessionId))
    .collect()

  for (const child of children) {
    // All child reports are suppressed as well
    await stopForSession(ctx, child._id, { suppressReport: true })
  }
}

/** Kills the sidecar jobs a session started. */
export async function killSessionJobs(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  includeBackground?: boolean,
) {
  const session = await ctx.db.get(sessionId)
  if (!session) return

  await ctx.scheduler.runAfter(0, internal.actions.terminals._killSessionJobs, {
    sessionId: sharedSessionId(session),
    owner: sessionId,
    ...(includeBackground && { includeBackground }),
  })
}

export async function stopForSession(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  options?: { suppressReport?: boolean },
) {
  await stopChildSessions(ctx, sessionId)
  await releaseForSession(ctx, sessionId)
  await killSessionJobs(ctx, sessionId, true)

  const streams = await ctx.db
    .query('streams')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  for (const stream of streams) {
    await stopExecution(ctx, stream, options)
  }
}

export async function stopForUser(ctx: MutationCtx, userId: Id<'users'>) {
  const streams = await ctx.db
    .query('streams')
    .withIndex('by_invokedBy', (q) => q.eq('invokedBy', userId))
    .collect()

  for (const stream of streams) {
    await stopExecution(ctx, stream)
  }
}
