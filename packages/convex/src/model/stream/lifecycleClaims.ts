import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { StreamExecutionArgs } from '../../types'
import { streamOutputIdentity } from '../chat/identities'
import { injectModeNote } from '../chat/notes'
import { injectDueReminders } from '../chat/reminders'
import { getProcessingSegmentRow, insertMessage } from '../messageContents'
import { matchesExecution, ownsExecution } from './execution'
import { scheduleStream, startExecution } from './execution'
import { renewStreamLease } from './lease'
import { consumeInterjections } from './lifecycleProgress'
import { honorSoftStop } from './stop'

export { STREAM_LEASE_MS } from './lease'

export const APPROVAL_LEASE_MS = 7 * 24 * 60 * 60 * 1000

export async function _claim(
  ctx: MutationCtx,
  { streamId, generation }: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(streamId)
  if (!matchesExecution(stream, { streamId, generation })) return null
  const scheduled =
    stream.state.phase === 'pending' || stream.state.phase === 'retrying'
  if (!scheduled) return null

  if (!stream.state.processingMessageId) {
    const claimed = await claimFreshTurn(ctx, stream)
    return claimed
  }

  const row = await getProcessingSegmentRow(ctx, stream)

  // A post-split empty segment is NOT fresh: recomputing the boundary
  // mid-turn would pull the turn's own sealed segments into its context.
  const fresh =
    stream.command.kind !== 'retry' &&
    (!row || (row.segmentIndex === 0 && row.parts.length === 0))

  let boundaryId = stream.contextBoundaryMessageId
  let boundaryCreationTime = stream.contextBoundaryCreationTime
  let processingMessageId = stream.state.processingMessageId
  let processingContentId = stream.state.processingContentId

  const preserveContextBoundary =
    stream.command.kind === 'compact' && stream.command.preserveContextBoundary

  if (fresh && !preserveContextBoundary) {
    // Only compute the context boundary for a fresh segment to preserve tool approvals
    const boundary = await latestContextMessage(ctx, stream.sessionId)
    boundaryId = boundary?._id
    boundaryCreationTime = boundary?._creationTime
  } else if (stream.command.kind === 'invoke') {
    const current = await ctx.db.get(stream.state.processingMessageId)
    // Only this stream's own turn may roll over. /resume and retry streams point
    // at pre-existing messages that must keep streaming into themselves
    if (current && current._creationTime > stream._creationTime) {
      const consumed = await consumeInterjections(ctx, stream)
      if (consumed) {
        const updated = await ctx.db.get(streamId)
        if (updated?.state.processingMessageId) {
          boundaryId = updated.contextBoundaryMessageId
          boundaryCreationTime = updated.contextBoundaryCreationTime
          processingMessageId = updated.state.processingMessageId
          processingContentId = updated.state.processingContentId
        }
      }
    }
  }

  return startExecution(
    ctx,
    stream,
    { processingMessageId, processingContentId },
    {
      contextBoundaryMessageId: boundaryId,
      contextBoundaryCreationTime: boundaryCreationTime,
    },
  )
}

/**
 * Hands a turn that is approaching the action time limit to a freshly
 * scheduled action.
 */
export async function _handoff(
  ctx: MutationCtx,
  { streamId, generation }: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(streamId)
  if (!ownsExecution(stream, { streamId, generation })) return false
  if (await honorSoftStop(ctx, stream)) return false

  await scheduleStream(ctx, streamId)

  return true
}

/** Keeps the lease alive while a step streams nothing patchable. */
export async function _heartbeat(
  ctx: MutationCtx,
  { streamId, generation }: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(streamId)
  if (!ownsExecution(stream, { streamId, generation })) return

  await renewStreamLease(ctx, stream)
}

/** Materializes the processing message for a turn that is starting to stream. */
export async function claimFreshTurn(ctx: MutationCtx, stream: Doc<'streams'>) {
  if (stream.command.kind === 'invoke') {
    const session = await ctx.db.get(stream.sessionId)
    if (session) {
      // Catch up a mode change nothing has announced yet (session created in
      // plan mode, inherited by a sub-agent, flipped by an approved tool call)
      await injectModeNote(ctx, session, stream.invokedBy)
      // Inject due reminders to include them in the next turn's context
      await injectDueReminders(ctx, session, stream.invokedBy)
    }
  }

  const preserveContextBoundary =
    stream.command.kind === 'compact' && stream.command.preserveContextBoundary
  const boundary = preserveContextBoundary
    ? null
    : await latestContextMessage(ctx, stream.sessionId)
  const boundaryId = preserveContextBoundary
    ? stream.contextBoundaryMessageId
    : boundary?._id
  const boundaryCreationTime = preserveContextBoundary
    ? stream.contextBoundaryCreationTime
    : boundary?._creationTime
  const output = await streamOutputIdentity(ctx, stream)

  const { messageId, contentId } = await insertMessage(
    ctx,
    {
      sessionId: stream.sessionId,
      sender: output.sender,
      role: output.role,
      ...output.identity,
      type: stream.command.kind === 'compact' ? 'summary' : undefined,
      summaryBoundaryCreationTime:
        stream.command.kind === 'compact' ? boundaryCreationTime : undefined,
      status: 'processing',
    },
    [],
  )

  return startExecution(
    ctx,
    stream,
    {
      processingMessageId: messageId,
      processingContentId: contentId,
    },
    {
      contextBoundaryMessageId: boundaryId,
      contextBoundaryCreationTime: boundaryCreationTime,
    },
  )
}

export function latestContextMessage(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  return ctx.db
    .query('messages')
    .withIndex('by_sessionId_status_contextEligible', (q) =>
      q
        .eq('sessionId', sessionId)
        .eq('status', 'done')
        .eq('contextEligible', true),
    )
    .order('desc')
    .first()
}
