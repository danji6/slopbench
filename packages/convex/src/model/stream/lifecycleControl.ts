import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { sharedSessionId } from '../../lib/subagent'
import { releaseForSession } from '../shellJobs'
import { STREAM_LEASE_MS } from './lifecycleClaims'
import { honorSoftStop } from './stop'

/** Stops a timed out stream at the seam after its current provider step. */
export async function _honorSoftStop(
  ctx: MutationCtx,
  { streamId }: { streamId: Id<'streams'> },
) {
  const stream = await ctx.db.get(streamId)
  return stream ? honorSoftStop(ctx, stream) : false
}

export async function _scheduleRetry(
  ctx: MutationCtx,
  {
    streamId,
    retryAt,
    retryError,
  }: { streamId: Id<'streams'>; retryAt: number; retryError: string },
) {
  const stream = await ctx.db.get(streamId)
  if (!stream || stream.status === 'stopping') return
  if (await honorSoftStop(ctx, stream)) return

  const jobId = await ctx.scheduler.runAt(
    retryAt,
    internal.actions.streams._stream,
    {
      streamId,
    },
  )

  await ctx.db.patch(streamId, {
    status: 'retrying',
    attempt: stream.attempt + 1,
    retryAt,
    retryError,
    jobId,
    leaseExpiresAt: retryAt + STREAM_LEASE_MS,
  })
}

export async function _omitActiveMedia(
  ctx: MutationCtx,
  { streamId }: { streamId: Id<'streams'> },
) {
  const stream = await ctx.db.get(streamId)
  if (stream && stream.status !== 'stopping') {
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
    if (stream.jobId) await ctx.scheduler.cancel(stream.jobId)

    await ctx.db.patch(stream._id, {
      status: 'stopping',
      suppressFollowUp: true,
      ...(options?.suppressReport ? { suppressReport: true } : {}),
    })

    await ctx.scheduler.runAfter(0, internal.streams._finalizeStopped, {
      streamId: stream._id,
    })
  }
}

export async function stopForUser(ctx: MutationCtx, userId: Id<'users'>) {
  const streams = await ctx.db
    .query('streams')
    .withIndex('by_invokedBy', (q) => q.eq('invokedBy', userId))
    .collect()

  for (const stream of streams) {
    if (stream.jobId) await ctx.scheduler.cancel(stream.jobId)

    await ctx.db.patch(stream._id, {
      status: 'stopping',
      suppressFollowUp: true,
    })

    await ctx.scheduler.runAfter(0, internal.streams._finalizeStopped, {
      streamId: stream._id,
    })
  }
}
