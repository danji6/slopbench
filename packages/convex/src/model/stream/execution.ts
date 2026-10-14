import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type {
  RunningStream,
  StreamExecutionArgs,
  StreamState,
} from '../../types'
import { STREAM_LEASE_MS } from './lease'

/** Identifies the action that owns this stream execution. */
export function matchesExecution(
  stream: Doc<'streams'> | null,
  args: StreamExecutionArgs,
): stream is Doc<'streams'> {
  return stream?.generation === args.generation
}

export function ownsExecution(
  stream: Doc<'streams'> | null,
  args: StreamExecutionArgs,
): stream is RunningStream {
  if (!matchesExecution(stream, args)) return false
  return stream.state.phase === 'streaming'
}

/** Cancels only work still owned by a scheduled phase. */
export async function cancelScheduledExecution(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
) {
  const { state } = stream
  if (state.phase === 'pending' || state.phase === 'retrying') {
    await ctx.scheduler.cancel(state.jobId)
  }
}

type StreamOutput = {
  processingMessageId: Id<'messages'>
  processingContentId?: Id<'messageContents'>
}

type StreamBoundary = {
  contextBoundaryMessageId?: Id<'messages'>
  contextBoundaryCreationTime?: number
}

type ScheduleOptions =
  | {
      kind?: 'pending'
      delayMs?: number
      fireAt?: number
      resetAttempt?: boolean
    }
  | {
      kind: 'retrying'
      retryAt: number
      retryError: string
    }

/** Replaces scheduled work atomically and invalidates the previous execution. */
export async function scheduleStream(
  ctx: MutationCtx,
  streamId: Id<'streams'>,
  options: ScheduleOptions = {},
) {
  const stream = await ctx.db.get(streamId)
  if (!stream) error('Cannot schedule a missing stream', 409)
  if (stream.state.phase === 'stopping')
    error('Cannot schedule a stopping stream', 409)

  await cancelScheduledExecution(ctx, stream)

  const generation = stream.generation + 1
  const args = { streamId, generation }
  const next =
    options.kind === 'retrying'
      ? await scheduleRetryState(ctx, stream, args, options)
      : await schedulePendingState(ctx, stream, args, options)

  await ctx.db.patch(streamId, { generation, ...next })
}

/** Schedules a fresh action without consuming another provider retry attempt. */
async function schedulePendingState(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  args: StreamExecutionArgs,
  options: Exclude<ScheduleOptions, { kind: 'retrying' }>,
) {
  const jobId = await ctx.scheduler.runAfter(
    options.delayMs ?? 0,
    internal.actions.streams._stream,
    args,
  )
  const state: StreamState = {
    phase: 'pending',
    jobId,
    fireAt: options.fireAt,
    processingMessageId: stream.state.processingMessageId,
    processingContentId: stream.state.processingContentId,
  }
  return {
    state,
    attempt: options.resetAttempt ? 0 : stream.attempt,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
  }
}

/** Schedules a provider retry with its error and a lease covering the delay. */
async function scheduleRetryState(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  args: StreamExecutionArgs,
  options: Extract<ScheduleOptions, { kind: 'retrying' }>,
) {
  const processingMessageId = stream.state.processingMessageId
  if (!processingMessageId) error('Cannot retry an unclaimed stream', 409)
  const jobId = await ctx.scheduler.runAt(
    options.retryAt,
    internal.actions.streams._stream,
    args,
  )
  const state: StreamState = {
    phase: 'retrying',
    jobId,
    retryAt: options.retryAt,
    retryError: options.retryError,
    processingMessageId,
    processingContentId: stream.state.processingContentId,
  }
  return {
    state,
    attempt: stream.attempt + 1,
    leaseExpiresAt: options.retryAt + STREAM_LEASE_MS,
  }
}

/** Claims the current output and drops all scheduled-phase data. */
export async function startExecution(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  output: StreamOutput,
  boundary: StreamBoundary,
): Promise<RunningStream> {
  const state = { phase: 'streaming' as const, ...output }
  const leaseExpiresAt = Date.now() + STREAM_LEASE_MS
  await ctx.db.patch(stream._id, { state, ...boundary, leaseExpiresAt })
  return { ...stream, state, ...boundary, leaseExpiresAt }
}
