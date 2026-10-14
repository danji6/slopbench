import { v } from 'convex/values'

export const eventDedupeKeyValidator = v.union(
  v.literal('timeout'),
  v.literal('autoCompact'),
)

export const eventTriggerValidator = v.union(
  v.object({ type: v.literal('at'), at: v.number() }),
  v.object({ type: v.literal('stream_end') }),
)

export const eventActionValidator = v.union(
  v.object({ type: v.literal('soft_stop_stream') }),
  v.object({ type: v.literal('compact_session') }),
)

/** A durable trigger and action scheduled for a session. */
export const scheduledEventSchema = v.object({
  sessionId: v.id('sessions'),
  invokedBy: v.id('users'),
  dedupeKey: eventDedupeKeyValidator,
  trigger: eventTriggerValidator,
  action: eventActionValidator,
  targetStreamId: v.optional(v.id('streams')),
  messageId: v.id('messages'),
  jobId: v.optional(v.id('_scheduled_functions')),
})
