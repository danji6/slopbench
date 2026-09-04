import { parseDurationMs } from '@sb/core/utils/duration'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error, sanitizeChatError } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import * as Events from '../scheduledEvents'
import * as Memberships from '../session/memberships'
import { requestImmediateStop } from '../stream/stop'
import { insertCommandChip } from './commandChips'
import { executeCompact } from './send'

export async function timeout(
  ctx: AuthMutationCtx,
  { sessionId, duration }: { sessionId: Id<'sessions'>; duration: string },
) {
  const { session } = await Memberships.requireMember(
    ctx,
    sessionId,
    ctx.userId,
  )
  Memberships.requireEnabled(session)

  const stream = await Memberships.getActiveStream(ctx, sessionId)
  if (!stream) error('No active agent turn', 409)

  let delayMs: number
  try {
    delayMs = parseDurationMs(duration)
  } catch {
    error('Use a non negative duration in seconds, or with s, m, or h', 400)
  }

  const at = Date.now() + delayMs
  if (!Number.isFinite(at) || Number.isNaN(new Date(at).getTime())) {
    error('Invalid number', 400)
  }

  const messageId = await insertCommandChip(
    ctx,
    session,
    ctx.userId,
    { name: 'timeout', argument: duration.trim() },
    'queued',
  )

  await Events.replace(ctx, {
    sessionId,
    invokedBy: ctx.userId,
    dedupeKey: 'timeout',
    trigger: { type: 'at', at },
    action: { type: 'soft_stop_stream' },
    targetStreamId: stream._id,
    messageId,
  })
}

export async function autoCompact(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const { session } = await Memberships.requireMember(
    ctx,
    sessionId,
    ctx.userId,
  )
  Memberships.requireEnabled(session)
  if (!session.activeAgentId) error('No active agent', 409)

  const stream = await Memberships.getActiveStream(ctx, sessionId)
  const targetStreamId = stream?.operation === 'invoke' ? stream._id : undefined
  const messageId = await insertCommandChip(
    ctx,
    session,
    ctx.userId,
    { name: 'autoCompact' },
    'queued',
  )

  await Events.replace(ctx, {
    sessionId,
    invokedBy: ctx.userId,
    dedupeKey: 'autoCompact',
    trigger: { type: 'stream_end' },
    action: { type: 'compact_session' },
    targetStreamId,
    messageId,
  })
}

/** Runs an event. The scheduled function itself must not be cancelled. */
export async function runScheduledEvent(
  ctx: MutationCtx,
  { eventId }: { eventId: Id<'scheduledEvents'> },
) {
  const event = await Events.getById(ctx, eventId)
  if (!event || event.trigger.type !== 'at') return

  const chip = await ctx.db.get(event.messageId)
  if (!chip) {
    await Events.cancel(ctx, event, 'Command deleted', {
      markChip: false,
      cancelJob: false,
    })
    return
  }

  const stream = event.targetStreamId
    ? await ctx.db.get(event.targetStreamId)
    : null
  if (
    !stream ||
    stream.sessionId !== event.sessionId ||
    stream.status === 'stopping' ||
    stream.status === 'failed'
  ) {
    await Events.cancel(ctx, event, 'Turn finished before timeout', {
      cancelJob: false,
    })
    return
  }

  if (stream.status === 'streaming') {
    await ctx.db.patch(stream._id, { stopAt: Date.now() })
    await Events.consume(ctx, event, { cancelJob: false })
  } else {
    const result = await requestImmediateStop(ctx, stream)
    await Events.consume(ctx, event, { cancelJob: false })
    if (result === 'deleted') {
      await handleStreamEnd(ctx, stream, 'stopped')
    }
  }
}

export type StreamEndOutcome = 'complete' | 'failed' | 'stopped'

/** Dispatches and cleans up events attached to a stream's end boundary. */
export async function handleStreamEnd(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  outcome: StreamEndOutcome,
): Promise<boolean> {
  const targeted = await Events.listByTarget(ctx, stream._id)
  for (const event of targeted) {
    if (event.action.type === 'soft_stop_stream') {
      await Events.cancel(ctx, event, 'Turn finished before timeout')
    }
  }

  if (stream.operation !== 'invoke') return false

  const event = await Events.getByKey(ctx, stream.sessionId, 'autoCompact')
  if (!event || event.action.type !== 'compact_session') return false
  if (event.targetStreamId && event.targetStreamId !== stream._id) {
    // An expired stream may be cleaned up by a membership read. Treat a missing
    // old target as rearmed for this invoke.
    if (await ctx.db.get(event.targetStreamId)) return false
    await ctx.db.patch(event._id, { targetStreamId: undefined })
  }

  if (outcome === 'stopped') {
    if (event.targetStreamId) {
      await ctx.db.patch(event._id, { targetStreamId: undefined })
    }
    return false
  }

  const session = await ctx.db.get(stream.sessionId)
  if (!session) {
    await Events.cancel(ctx, event, 'Session no longer exists')
    return false
  }

  try {
    const compactStreamId = await executeCompact(
      ctx,
      session,
      event.invokedBy,
      undefined,
      {
        boundaryId: stream.processingMessageId,
        preserveContextBoundary: Boolean(stream.processingMessageId),
        followUpAfterCompact:
          outcome === 'complete' && !stream.suppressFollowUp,
      },
    )
    if (!compactStreamId) error('Session is busy', 409)
    await Events.consume(ctx, event)
    return true
  } catch (cause) {
    await Events.fail(ctx, event, sanitizeChatError(cause))
    // The one-shot was consumed by this turn. A failed compaction must not
    // fall through to the source turn's ordinary automatic follow-up.
    return true
  }
}
