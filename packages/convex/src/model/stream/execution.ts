import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { StreamExecutionArgs } from '../../types'

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
): stream is Doc<'streams'> {
  if (!matchesExecution(stream, args)) return false
  return stream.status === 'streaming'
}

type ScheduleOptions = {
  delayMs?: number
  at?: number
  status?: 'pending' | 'retrying'
}

/** Replaces scheduled work atomically and invalidates the previous execution. */
export async function scheduleStream(
  ctx: MutationCtx,
  streamId: Id<'streams'>,
  options: ScheduleOptions = {},
) {
  const stream = await ctx.db.get(streamId)
  if (!stream) error('Cannot schedule a missing stream', 409)
  if (stream.jobId) await ctx.scheduler.cancel(stream.jobId)

  const generation = stream.generation + 1
  const args = { streamId, generation }

  const jobId =
    options.at === undefined
      ? await ctx.scheduler.runAfter(
          options.delayMs ?? 0,
          internal.actions.streams._stream,
          args,
        )
      : await ctx.scheduler.runAt(
          options.at,
          internal.actions.streams._stream,
          args,
        )

  await ctx.db.patch(streamId, {
    generation,
    jobId,
    status: options.status ?? 'pending',
  })

  return jobId
}
