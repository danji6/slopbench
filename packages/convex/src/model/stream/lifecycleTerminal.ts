import { settleAbortedAskParts } from '@sb/core/utils/ask'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { settleAbandonedTaskParts } from '../../lib/subagent'
import type { FailStreamArgs, StreamExecutionArgs } from '../../types'
import { cleanUpGeneratedAttachments } from '../attachments'
import { clearAnnouncedMode } from '../chat/notes'
import { handleStreamEnd } from '../chat/scheduling'
import {
  finalizeTurn,
  getProcessingSegmentRow,
  listSelectedSegments,
  sealSegment,
} from '../messageContents'
import {
  finalizeMessageParts,
  scheduleMessageEval,
  scheduleTitle,
  syncActivity,
} from '../messages'
import {
  notificationPreviewFromParts,
  notifyAgentEvent,
} from '../notifications'
import { createPlanLinkPart, getBySession as getPlan } from '../plans'
import { ownsExecution } from './execution'
import { cleanUpOffloadedOutputs } from './lifecycleCleanup'
import { killSessionJobs } from './lifecycleControl'
import { reserveFollowUp } from './lifecycleReservations'
import { restoreEmptyRetry } from './stoppedRetry'
import { deliverChildReport } from './subagents'

export async function _complete(
  ctx: MutationCtx,
  { streamId, generation }: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(streamId)
  if (!ownsExecution(stream, { streamId, generation })) return

  const processingMessageId = stream.state.processingMessageId
  const message = await ctx.db.get(processingMessageId)
  const row = await getProcessingSegmentRow(ctx, stream)
  const parts = row?.parts ?? []

  // Have the plan survive compaction
  if (stream.command.kind === 'compact') {
    const plan = await getPlan(ctx, stream.sessionId)
    if (plan) parts.push(createPlanLinkPart(plan))
    // The mode note is behind the new boundary, state it again on the next turn
    await clearAnnouncedMode(ctx, stream.sessionId)
  }

  if (row && message) {
    await finalizeTurn(ctx, {
      message,
      row,
      parts,
      metadata: row.metadata,
    })
  } else {
    await ctx.db.patch(processingMessageId, { status: 'done' })
  }

  await discardStream(ctx, streamId)

  const scheduledCompact = await handleStreamEnd(ctx, stream, 'complete')

  await scheduleMessageEval(ctx, {
    messageId: processingMessageId,
    invokerId: stream.invokedBy,
    parts,
    version: row?.version ?? 1,
    segmentIndex: row?.segmentIndex ?? 0,
  })

  const compactionNeedsFollowUp =
    stream.command.kind === 'compact' && stream.command.followUpAfterCompact
  let followUpReserved = scheduledCompact
  if (stream.command.kind === 'invoke') {
    await syncActivity(ctx, stream.sessionId, parts)
    await scheduleTitle(ctx, stream.sessionId)
    if (!scheduledCompact && !stream.suppressFollowUp) {
      followUpReserved = await reserveFollowUp(ctx, stream)
    }
  } else if (compactionNeedsFollowUp) {
    followUpReserved = await reserveFollowUp(ctx, stream)
  } else if (await isLatestRetry(ctx, stream, message)) {
    // A retry of the newest message becomes the session's tail
    await syncActivity(ctx, stream.sessionId, parts)
    await scheduleTitle(ctx, stream.sessionId)
  }

  // A finished sub-agent turn reports back to its parent session
  await deliverChildReport(ctx, stream, { kind: 'complete' })

  // The automatic follow-up owns the eventual completion notification
  if (!followUpReserved) {
    // Retries may span segments, so preview the selected message version
    const previewParts = message
      ? (await listSelectedSegments(ctx, message)).flatMap((row) => row.parts)
      : parts

    const previewMessage =
      stream.command.kind === 'compact'
        ? 'Compaction finished'
        : notificationPreviewFromParts(previewParts)

    await notifyAgentEvent(ctx, {
      sessionId: stream.sessionId,
      agentId: stream.agentId,
      kind: 'turn_completed',
      preview: previewMessage,
      sourceMessageId: stream.state.processingMessageId,
    })
  }

  // Scheduled, not inline: a bad command must not roll back this turn
  await scheduleCommandDrain(ctx, stream.sessionId)
}

/** Gives any command that was waiting on this stream a chance to run. */
export function scheduleCommandDrain(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  return ctx.scheduler.runAfter(0, internal.chat._drainCommandQueue, {
    sessionId,
  })
}

/** True when a 'retry' stream regenerated the session's newest message. */
export async function isLatestRetry(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  message: Doc<'messages'> | null,
) {
  if (stream.command.kind !== 'retry' || !message) return false

  const newer = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .gt('_creationTime', message._creationTime),
    )
    .first()

  return !newer
}

export async function _fail(ctx: MutationCtx, args: FailStreamArgs) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return
  return failStream(ctx, stream, args.message)
}

/** Settles a current stream from trusted lifecycle maintenance. */
export async function failStream(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  message: string,
) {
  const streamId = stream._id

  if (stream.state.processingMessageId) {
    const row = await getProcessingSegmentRow(ctx, stream)
    if (row) {
      // Task calls the turn never got to spawn can't report back
      const parts = finalizeMessageParts(
        settleAbandonedTaskParts(row.parts) ?? row.parts,
      )
      await sealSegment(ctx, row, parts, {
        ...row.metadata,
        error: message,
      })
    }
    const doc = await ctx.db.get(stream.state.processingMessageId)
    await ctx.db.patch(stream.state.processingMessageId, {
      status: 'done',
      metadata: { ...doc?.metadata, error: message },
    })
    await demoteFailedSummary(ctx, stream)
  }

  await discardStream(ctx, streamId)

  await handleStreamEnd(ctx, stream, 'failed')

  await notifyAgentEvent(ctx, {
    sessionId: stream.sessionId,
    agentId: stream.agentId,
    kind: 'turn_error',
    sourceMessageId: stream.state.processingMessageId,
  })

  // A failed sub-agent still reports back so the parent can react
  await deliverChildReport(ctx, stream, { kind: 'failed', message })

  await scheduleCommandDrain(ctx, stream.sessionId)
}

export async function _finalizeStopped(
  ctx: MutationCtx,
  { streamId }: { streamId: Id<'streams'> },
) {
  const stream = await ctx.db.get(streamId)
  if (!stream || stream.state.phase !== 'stopping') return

  // Turn stopped before it materialized a message, just drop the stream
  if (!stream.state.processingMessageId) {
    await discardStream(ctx, streamId)
    await handleStreamEnd(ctx, stream, 'stopped')
    await scheduleCommandDrain(ctx, stream.sessionId)
    return
  }

  const processingMessageId = stream.state.processingMessageId
  const message = await ctx.db.get(processingMessageId)
  const row = await getProcessingSegmentRow(ctx, stream)
  // Task calls the turn never got to spawn can't report back
  const rawParts = row?.parts ?? []
  const taskSettled = settleAbandonedTaskParts(rawParts) ?? rawParts
  const parts = finalizeMessageParts(settleAbortedAskParts(taskSettled))
  const metadata = preserveStoppedStreamError(
    row?.metadata,
    stream.state.retryError,
  )
  const restored =
    row && message ? await restoreEmptyRetry(ctx, stream, message, row) : false

  if (!restored && row && message) {
    await finalizeTurn(ctx, { message, row, parts, metadata })
  } else if (!restored) {
    await ctx.db.patch(processingMessageId, {
      status: 'done',
      metadata: preserveStoppedStreamError(
        message?.metadata,
        stream.state.retryError,
      ),
    })
  }
  await demoteFailedSummary(ctx, stream)

  await discardStream(ctx, streamId)

  await handleStreamEnd(ctx, stream, 'stopped')

  if (!restored) {
    await scheduleMessageEval(ctx, {
      messageId: processingMessageId,
      invokerId: stream.invokedBy,
      parts,
      version: row?.version ?? 1,
      segmentIndex: row?.segmentIndex ?? 0,
    })
  }

  if (stream.command.kind === 'invoke') {
    await syncActivity(ctx, stream.sessionId, parts)
    await scheduleTitle(ctx, stream.sessionId)
  } else if (!restored && (await isLatestRetry(ctx, stream, message))) {
    await syncActivity(ctx, stream.sessionId, parts)
    await scheduleTitle(ctx, stream.sessionId)
  }

  // Foreground sidecar jobs must not outlive the stream that started them
  await killSessionJobs(ctx, stream.sessionId)

  await deliverChildReport(ctx, stream, { kind: 'stopped' })

  await scheduleCommandDrain(ctx, stream.sessionId)
}

export async function demoteFailedSummary(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
) {
  if (stream.command.kind !== 'compact') return
  if (!stream.state.processingMessageId) return
  await ctx.db.patch(stream.state.processingMessageId, { type: undefined })
}

export function preserveStoppedStreamError(
  metadata: Doc<'messages'>['metadata'],
  retryError: string | undefined,
): Doc<'messages'>['metadata'] {
  if (!retryError) return metadata

  const previous = metadata?.error
  if (!previous || previous === retryError) {
    return { ...metadata, error: retryError }
  }

  return { ...metadata, error: `${previous}\n${retryError}` }
}

/** Reclaims unused output before deleting its owning stream. */
export async function discardStream(ctx: MutationCtx, streamId: Id<'streams'>) {
  await cleanUpOffloadedOutputs(ctx, streamId)
  await cleanUpGeneratedAttachments(ctx, streamId)
  await ctx.db.delete(streamId)
}
