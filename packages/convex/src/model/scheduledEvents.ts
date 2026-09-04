import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { markCommandChip } from './chat/commandChips'

export type ScheduledEvent = Doc<'scheduledEvents'>

export type ScheduledEventFields = Omit<
  ScheduledEvent,
  '_id' | '_creationTime' | 'jobId'
>

export function getById(ctx: QueryCtx, eventId: Id<'scheduledEvents'>) {
  return ctx.db.get(eventId)
}

export function getByKey(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  dedupeKey: ScheduledEvent['dedupeKey'],
) {
  return ctx.db
    .query('scheduledEvents')
    .withIndex('by_sessionId_dedupeKey', (q) =>
      q.eq('sessionId', sessionId).eq('dedupeKey', dedupeKey),
    )
    .unique()
}

export function listByTarget(ctx: QueryCtx, streamId: Id<'streams'>) {
  return ctx.db
    .query('scheduledEvents')
    .withIndex('by_targetStreamId', (q) => q.eq('targetStreamId', streamId))
    .collect()
}

/** Replaces the same keyed event and schedules triggers. */
export async function replace(ctx: MutationCtx, fields: ScheduledEventFields) {
  const existing = await getByKey(ctx, fields.sessionId, fields.dedupeKey)
  if (existing) {
    await cancel(ctx, existing, 'Replaced by a newer schedule')
  }

  const eventId = await ctx.db.insert('scheduledEvents', fields)
  if (fields.trigger.type !== 'at') return eventId

  const jobId = await ctx.scheduler.runAt(
    fields.trigger.at,
    internal.chat._runScheduledEvent,
    { eventId },
  )
  await ctx.db.patch(eventId, { jobId })

  return eventId
}

export async function consume(
  ctx: MutationCtx,
  event: ScheduledEvent,
  options?: { cancelJob?: boolean },
) {
  await remove(ctx, event, options)
  await markCommandChip(ctx, event.messageId, 'ran')
}

export async function fail(
  ctx: MutationCtx,
  event: ScheduledEvent,
  message: string,
  options?: { cancelJob?: boolean },
) {
  await remove(ctx, event, options)
  await markCommandChip(ctx, event.messageId, 'failed', message)
}

export async function cancel(
  ctx: MutationCtx,
  event: ScheduledEvent,
  reason: string,
  options?: { markChip?: boolean; cancelJob?: boolean },
) {
  await remove(ctx, event, { cancelJob: options?.cancelJob })
  if (options?.markChip !== false) {
    await markCommandChip(ctx, event.messageId, 'cancelled', reason)
  }
}

export async function cancelByMessage(
  ctx: MutationCtx,
  messageId: Id<'messages'>,
) {
  const event = await ctx.db
    .query('scheduledEvents')
    .withIndex('by_messageId', (q) => q.eq('messageId', messageId))
    .unique()
  if (event) await cancel(ctx, event, 'Command deleted', { markChip: false })
}

export async function cancelForSession(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const events = await ctx.db
    .query('scheduledEvents')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()
  for (const event of events) {
    await cancel(ctx, event, 'Session removed', { markChip: false })
  }
}

async function remove(
  ctx: MutationCtx,
  event: ScheduledEvent,
  options?: { cancelJob?: boolean },
) {
  if (event.jobId && options?.cancelJob !== false) {
    await ctx.scheduler.cancel(event.jobId)
  }
  await ctx.db.delete(event._id)
}
