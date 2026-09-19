import { MESSAGE_SPLIT_BUDGET_BYTES } from '@sb/core/const'
import { serializedSize } from '@sb/core/utils/size'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { senderIdentity } from '../chat/identities'
import { injectModeNote } from '../chat/notes'
import { injectDueReminders } from '../chat/reminders'
import {
  appendSegment,
  finalizeTurn,
  getProcessingSegmentRow,
  insertMessage,
  patchSegmentParts,
  sealSegment,
} from '../messageContents'
import {
  notACommandChip,
  notAUserKilledReport,
  scheduleMessageEval,
} from '../messages'
import { advanceStepCount } from '../session/state'
import { STREAM_LEASE_MS } from './lifecycleClaims'

export async function _patchMessage(
  ctx: MutationCtx,
  { streamId, parts }: { streamId: Id<'streams'>; parts: unknown[] },
) {
  const stream = await ctx.db.get(streamId)
  if (!stream || stream.status === 'stopping' || !stream.processingMessageId) {
    return false
  }

  const row = await getProcessingSegmentRow(ctx, stream)
  if (!row) return false

  await patchSegmentParts(ctx, stream.processingMessageId, row, parts)

  await ctx.db.patch(streamId, { leaseExpiresAt: Date.now() + STREAM_LEASE_MS })

  return true
}

/**
 * Seals the in-flight turn and starts a fresh one when a message arrived after
 * it, moving the context boundary onto the newest message.
 *
 * @returns true when the turn was rolled over.
 */
export async function consumeInterjections(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
) {
  if (!stream.processingMessageId) return false

  const current = await ctx.db.get(stream.processingMessageId)
  if (!current) return false

  const row = await getProcessingSegmentRow(ctx, stream)

  // An approved call must execute in the turn that issued it. Rolling over
  // here would finalize it as unanswered before the resumed SDK stream gets a
  // chance to run the tool.
  if (row?.parts.some(isApprovedToolAwaitingExecution)) return false

  const newer = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .gt('_creationTime', current._creationTime),
    )
    .filter(notACommandChip)
    .filter(notAUserKilledReport)
    .order('desc')
    .first()

  if (!newer) return false

  if (row) {
    await finalizeTurn(ctx, {
      message: current,
      row,
      parts: row.parts,
      metadata: row.metadata,
    })
  } else {
    await ctx.db.patch(current._id, { status: 'done' })
  }
  await rolloverProcessingMessage(ctx, stream, current, newer)
  return true
}

export function isApprovedToolAwaitingExecution(part: unknown) {
  const typed = part as { type?: unknown; state?: unknown }
  return (
    typeof typed?.type === 'string' &&
    typed.type.startsWith('tool-') &&
    typed.state === 'approval-responded'
  )
}

export async function _continue(
  ctx: MutationCtx,
  { streamId }: { streamId: Id<'streams'> },
) {
  const stream = await ctx.db.get(streamId)
  if (!stream || stream.status === 'stopping' || !stream.processingMessageId) {
    return false
  }

  const current = await ctx.db.get(stream.processingMessageId)
  if (!current) return false

  const row = await getProcessingSegmentRow(ctx, stream)

  if (await consumeInterjections(ctx, stream)) return true

  // Split a large turn: seal the active segment and stream into a fresh
  // one. The doc stays processing, the context boundary doesn't move.
  const overCap =
    !!row &&
    stream.operation !== 'compact' &&
    serializedSize(row.parts) > MESSAGE_SPLIT_BUDGET_BYTES

  if (row && overCap) {
    await sealSegment(ctx, row, row.parts, row.metadata)
    await scheduleMessageEval(ctx, {
      messageId: current._id,
      invokerId: stream.invokedBy,
      parts: row.parts,
      version: row.version,
      segmentIndex: row.segmentIndex,
    })
    const contentId = await appendSegment(ctx, row)
    await ctx.db.patch(streamId, {
      processingContentId: contentId,
      attempt: 0,
      leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
    })
  } else {
    await ctx.db.patch(streamId, {
      attempt: 0,
      leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
    })
  }

  return true
}

/** Records a completed invoke step and injects notes at a safe continuation. */
export async function _recordStep(
  ctx: MutationCtx,
  {
    streamId,
    interruptible,
  }: { streamId: Id<'streams'>; interruptible: boolean },
) {
  const stream = await ctx.db.get(streamId)
  if (
    !stream ||
    stream.status === 'stopping' ||
    stream.operation !== 'invoke'
  ) {
    return false
  }

  const stepCount = await advanceStepCount(ctx, stream.sessionId)
  if (!interruptible) return true

  const session = await ctx.db.get(stream.sessionId)
  if (!session) return false

  // Mode transitions and interval reminders become transcript interjections.
  // _continue consumes them immediately after this mutation, never mid tool call.
  await injectModeNote(ctx, session, stream.invokedBy)
  await injectDueReminders(ctx, session, stream.invokedBy, stepCount)
  return true
}

/** Inserts a fresh output message and repoints the stream at it. */
export async function rolloverProcessingMessage(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  current: Doc<'messages'>,
  boundary: { _id: Id<'messages'>; _creationTime: number },
) {
  const { messageId, contentId } = await insertMessage(
    ctx,
    {
      sessionId: stream.sessionId,
      sender: current.sender,
      role: 'assistant',
      ...senderIdentity(current),
      status: 'processing',
    },
    [],
  )

  await ctx.db.patch(stream._id, {
    processingMessageId: messageId,
    processingContentId: contentId,
    contextBoundaryMessageId: boundary._id,
    contextBoundaryCreationTime: boundary._creationTime,
    attempt: 0,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
  })
}
