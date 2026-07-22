import { MESSAGE_SPLIT_BUDGET_BYTES } from '@sb/core/const'
import { serializedSize } from '@sb/core/utils/size'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { settleAbandonedTaskParts } from '../../lib/subagent'
import { cleanUpGeneratedAttachments } from '../attachments'
import { streamOutputIdentity } from '../chat/identities'
import { clearAnnouncedMode, injectModeNote } from '../chat/notes'
import { bumpTurnCount, injectDueReminders } from '../chat/reminders'
import {
  allVersionParts,
  appendSegment,
  finalizeTurn,
  getProcessingSegmentRow,
  insertMessage,
  patchSegmentParts,
  saveSegmentMeta,
  sealSegment,
} from '../messageContents'
import {
  finalizeMessageParts,
  notACommandChip,
  scheduleMessageEval,
  scheduleTitle,
  syncActivity,
} from '../messages'
import { createPlanLinkPart, getBySession as getPlan } from '../plans'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'
import { deliverChildReport } from './subagents'
import { collectToolOutputStorageIds } from './toolOutput'

export const STREAM_LEASE_MS = 5 * 60 * 1000
export const APPROVAL_LEASE_MS = 7 * 24 * 60 * 60 * 1000
const ORPHAN_OUTPUT_TTL_MS = 24 * 60 * 60 * 1000

export async function _claim(
  ctx: MutationCtx,
  { streamId }: { streamId: Id<'streams'> },
) {
  const stream = await ctx.db.get(streamId)
  if (
    !stream ||
    stream.status === 'stopping' ||
    stream.status === 'awaiting_approval'
  ) {
    return null
  }

  if (!stream.processingMessageId) {
    return claimFreshTurn(ctx, stream)
  }

  const row = await getProcessingSegmentRow(ctx, stream)

  // A post-split empty segment is NOT fresh: recomputing the boundary
  // mid-turn would pull the turn's own sealed segments into its context.
  const fresh =
    stream.operation !== 'retry' &&
    (!row || (row.segmentIndex === 0 && row.parts.length === 0))

  // Only compute the context boundary for a fresh segment to preserve tool approvals
  const boundary = fresh
    ? await latestContextMessage(ctx, stream.sessionId)
    : null

  const contextBoundaryMessageId = fresh
    ? boundary?._id
    : stream.contextBoundaryMessageId
  const contextBoundaryCreationTime = fresh
    ? boundary?._creationTime
    : stream.contextBoundaryCreationTime

  await ctx.db.patch(streamId, {
    status: 'streaming',
    contextBoundaryMessageId,
    contextBoundaryCreationTime,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
    jobId: undefined,
    retryAt: undefined,
    retryError: undefined,
  })

  return {
    ...stream,
    status: 'streaming' as const,
    contextBoundaryMessageId,
    contextBoundaryCreationTime,
  }
}

/** Materializes the processing message for a turn that is starting to stream. */
async function claimFreshTurn(ctx: MutationCtx, stream: Doc<'streams'>) {
  if (stream.operation === 'invoke') {
    const session = await ctx.db.get(stream.sessionId)
    if (session) {
      // Catch up a mode change nothing has announced yet (session created in
      // plan mode, inherited by a sub-agent, flipped by an approved tool call)
      await injectModeNote(ctx, session, stream.invokedBy)
      // Inject due reminders to include them in the next turn's context
      await injectDueReminders(ctx, session, stream.invokedBy)
    }
  }

  const boundary = await latestContextMessage(ctx, stream.sessionId)
  const output = await streamOutputIdentity(ctx, stream)

  const { messageId, contentId } = await insertMessage(
    ctx,
    {
      sessionId: stream.sessionId,
      sender: output.sender,
      role: output.role,
      senderSnapshot: output.senderSnapshot,
      type: stream.operation === 'compact' ? 'summary' : undefined,
      status: 'processing',
    },
    [],
  )

  await bumpTurnCount(ctx, stream.sessionId)

  await ctx.db.patch(stream._id, {
    status: 'streaming',
    processingMessageId: messageId,
    processingContentId: contentId,
    contextBoundaryMessageId: boundary?._id,
    contextBoundaryCreationTime: boundary?._creationTime,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
    jobId: undefined,
    retryAt: undefined,
    retryError: undefined,
  })

  return {
    ...stream,
    status: 'streaming' as const,
    processingMessageId: messageId,
    processingContentId: contentId,
    contextBoundaryMessageId: boundary?._id,
    contextBoundaryCreationTime: boundary?._creationTime,
  }
}

function latestContextMessage(ctx: MutationCtx, sessionId: Id<'sessions'>) {
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

export async function _trackOffloadedOutput(
  ctx: MutationCtx,
  {
    streamId,
    messageId,
    storageId,
  }: {
    streamId: Id<'streams'>
    messageId: Id<'messages'>
    storageId: Id<'_storage'>
  },
) {
  await ctx.db.insert('offloadedOutputs', { streamId, messageId, storageId })
}

/** Deletes tool output blobs that didn't make it into the final message. */
async function cleanUpOffloadedOutputs(
  ctx: MutationCtx,
  streamId: Id<'streams'>,
) {
  const rows = await ctx.db
    .query('offloadedOutputs')
    .withIndex('by_streamId', (q) => q.eq('streamId', streamId))
    .collect()
  if (rows.length === 0) return

  const validByMessage = new Map<Id<'messages'>, Set<Id<'_storage'>>>()
  for (const row of rows) {
    if (validByMessage.has(row.messageId)) continue
    validByMessage.set(
      row.messageId,
      new Set(
        collectToolOutputStorageIds(await allVersionParts(ctx, row.messageId)),
      ),
    )
  }

  for (const row of rows) {
    if (!validByMessage.get(row.messageId)?.has(row.storageId)) {
      await ctx.storage.delete(row.storageId).catch(() => {})
    }
    await ctx.db.delete(row._id)
  }
}

export async function pruneOrphanedOutputs(ctx: MutationCtx) {
  const cutoff = Date.now() - ORPHAN_OUTPUT_TTL_MS
  const rows = await ctx.db.query('offloadedOutputs').collect()

  for (const row of rows) {
    if (row._creationTime >= cutoff) continue
    // Leave rows for streams that are still running
    if (await ctx.db.get(row.streamId)) continue

    const valid = new Set(
      collectToolOutputStorageIds(await allVersionParts(ctx, row.messageId)),
    )
    if (!valid.has(row.storageId)) {
      await ctx.storage.delete(row.storageId).catch(() => {})
    }
    await ctx.db.delete(row._id)
  }
}

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

  const newer = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .gt('_creationTime', current._creationTime),
    )
    .filter(notACommandChip)
    .order('desc')
    .first()

  const row = await getProcessingSegmentRow(ctx, stream)

  if (newer) {
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

/** Inserts a fresh output message and repoints the stream at it. */
async function rolloverProcessingMessage(
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
      senderSnapshot: current.senderSnapshot,
      status: 'processing',
    },
    [],
  )

  await bumpTurnCount(ctx, stream.sessionId)

  await ctx.db.patch(stream._id, {
    processingMessageId: messageId,
    processingContentId: contentId,
    contextBoundaryMessageId: boundary._id,
    contextBoundaryCreationTime: boundary._creationTime,
    attempt: 0,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
  })
}

export async function _saveMeta(
  ctx: MutationCtx,
  {
    streamId,
    duration,
    toolErrors,
    warnings,
    usage,
  }: {
    streamId: Id<'streams'>
    duration: number
    toolErrors: string[]
    warnings: string[]
    usage: unknown
  },
) {
  const stream = await ctx.db.get(streamId)
  if (!stream) return

  const row = await getProcessingSegmentRow(ctx, stream)
  if (row && stream.processingMessageId) {
    // Accumulate step deltas into the segment's slice and the turn total
    const message = await ctx.db.get(stream.processingMessageId)
    const delta = { duration, toolErrors, warnings, usage }
    await saveSegmentMeta(ctx, {
      row,
      messageId: stream.processingMessageId,
      rowMetadata: accumulateMeta(row.metadata, delta),
      docMetadata: accumulateMeta(message?.metadata, delta),
    })
  }

  await accumulateSessionUsage(ctx, stream.sessionId, usage)
}

type MetaDelta = {
  duration: number
  toolErrors: string[]
  warnings: string[]
  usage: unknown
}

function accumulateMeta(
  prev: Doc<'messages'>['metadata'],
  delta: MetaDelta,
): Doc<'messages'>['metadata'] {
  return {
    ...prev,
    duration: (prev?.duration ?? 0) + delta.duration,
    toolErrors: [
      ...new Set([...(prev?.toolErrors ?? []), ...delta.toolErrors]),
    ],
    warnings: [...new Set([...(prev?.warnings ?? []), ...delta.warnings])],
    usage: delta.usage,
  }
}

type UsageDelta = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

async function accumulateSessionUsage(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  usage: unknown,
) {
  const delta = usage as UsageDelta | null | undefined
  if (!delta) return

  const session = await ctx.db.get(sessionId)
  if (!session) return

  const metadata = session.metadata ?? {}
  const prev = metadata.usage ?? {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  }

  await ctx.db.patch(sessionId, {
    metadata: {
      ...metadata,
      usage: {
        ...prev,
        inputTokens: prev.inputTokens + (delta.inputTokens ?? 0),
        outputTokens: prev.outputTokens + (delta.outputTokens ?? 0),
        totalTokens: prev.totalTokens + (delta.totalTokens ?? 0),
      },
    },
  })
}

export async function _complete(
  ctx: MutationCtx,
  { streamId }: { streamId: Id<'streams'> },
) {
  const stream = await ctx.db.get(streamId)
  if (!stream) return

  // A turn that never materialized a message has nothing to finalize
  if (!stream.processingMessageId) {
    await cleanUpOffloadedOutputs(ctx, streamId)
    await cleanUpGeneratedAttachments(ctx, streamId)
    await ctx.db.delete(streamId)
    await scheduleCommandDrain(ctx, stream.sessionId)
    return
  }

  const processingMessageId = stream.processingMessageId
  const message = await ctx.db.get(processingMessageId)
  const row = await getProcessingSegmentRow(ctx, stream)
  const parts = row?.parts ?? []

  // Have the plan survive compaction
  if (stream.operation === 'compact') {
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

  await cleanUpOffloadedOutputs(ctx, streamId)
  await cleanUpGeneratedAttachments(ctx, streamId)
  await ctx.db.delete(streamId)

  await scheduleMessageEval(ctx, {
    messageId: processingMessageId,
    invokerId: stream.invokedBy,
    parts,
    version: row?.version ?? 1,
    segmentIndex: row?.segmentIndex ?? 0,
  })

  if (stream.operation === 'invoke') {
    await syncActivity(ctx, stream.sessionId, parts)
    await scheduleTitle(ctx, stream.sessionId)
    if (!stream.suppressFollowUp) await reserveFollowUp(ctx, stream)
  } else if (await isLatestRetry(ctx, stream, message)) {
    // A retry of the newest message becomes the session's tail
    await syncActivity(ctx, stream.sessionId, parts)
    await scheduleTitle(ctx, stream.sessionId)
  }

  // A finished sub-agent turn reports back to its parent session
  await deliverChildReport(ctx, stream, { kind: 'complete' })

  // Scheduled, not inline: a bad command must not roll back this turn
  await scheduleCommandDrain(ctx, stream.sessionId)
}

/** Gives any command that was waiting on this stream a chance to run. */
function scheduleCommandDrain(ctx: MutationCtx, sessionId: Id<'sessions'>) {
  return ctx.scheduler.runAfter(0, internal.chat._drainCommandQueue, {
    sessionId,
  })
}

/** True when a 'retry' stream regenerated the session's newest message. */
async function isLatestRetry(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  message: Doc<'messages'> | null,
) {
  if (stream.operation !== 'retry' || !message) return false

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

export async function _fail(
  ctx: MutationCtx,
  { streamId, message }: { streamId: Id<'streams'>; message: string },
) {
  const stream = await ctx.db.get(streamId)
  if (!stream) return

  if (stream.processingMessageId) {
    const row = await getProcessingSegmentRow(ctx, stream)
    if (row) {
      // Task calls the turn never got to spawn can't report back
      const settled = settleAbandonedTaskParts(row.parts)
      await ctx.db.patch(row._id, {
        ...(settled ? { parts: settled } : {}),
        metadata: { ...row.metadata, error: message },
      })
    }
    const doc = await ctx.db.get(stream.processingMessageId)
    await ctx.db.patch(stream.processingMessageId, {
      status: 'done',
      metadata: { ...doc?.metadata, error: message },
    })
  }

  await cleanUpOffloadedOutputs(ctx, streamId)
  await cleanUpGeneratedAttachments(ctx, streamId)
  await ctx.db.delete(streamId)

  // A failed sub-agent still reports back so the parent can react
  await deliverChildReport(ctx, stream, { kind: 'failed', message })

  await scheduleCommandDrain(ctx, stream.sessionId)
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

export async function _finalizeStopped(
  ctx: MutationCtx,
  { streamId }: { streamId: Id<'streams'> },
) {
  const stream = await ctx.db.get(streamId)
  if (!stream) return

  // Turn stopped before it materialized a message, just drop the stream
  if (!stream.processingMessageId) {
    await cleanUpOffloadedOutputs(ctx, streamId)
    await cleanUpGeneratedAttachments(ctx, streamId)
    await ctx.db.delete(streamId)
    await scheduleCommandDrain(ctx, stream.sessionId)
    return
  }

  const processingMessageId = stream.processingMessageId
  const message = await ctx.db.get(processingMessageId)
  const row = await getProcessingSegmentRow(ctx, stream)
  // Task calls the turn never got to spawn can't report back
  const rawParts = row?.parts ?? []
  const parts = finalizeMessageParts(
    settleAbandonedTaskParts(rawParts) ?? rawParts,
  )
  const metadata = preserveStoppedStreamError(row?.metadata, stream.retryError)

  if (row && message) {
    await finalizeTurn(ctx, { message, row, parts, metadata })
  } else {
    await ctx.db.patch(processingMessageId, {
      status: 'done',
      metadata: preserveStoppedStreamError(
        message?.metadata,
        stream.retryError,
      ),
    })
  }

  await cleanUpOffloadedOutputs(ctx, streamId)
  await cleanUpGeneratedAttachments(ctx, streamId)
  await ctx.db.delete(streamId)

  await scheduleMessageEval(ctx, {
    messageId: processingMessageId,
    invokerId: stream.invokedBy,
    parts,
    version: row?.version ?? 1,
    segmentIndex: row?.segmentIndex ?? 0,
  })

  if (stream.operation === 'invoke') {
    await syncActivity(ctx, stream.sessionId, parts)
    await scheduleTitle(ctx, stream.sessionId)
  } else if (await isLatestRetry(ctx, stream, message)) {
    await syncActivity(ctx, stream.sessionId, parts)
    await scheduleTitle(ctx, stream.sessionId)
  }

  // Foreground sidecar jobs must not outlive the stream that started them
  await ctx.scheduler.runAfter(0, internal.actions.terminals._killSessionJobs, {
    sessionId: stream.sessionId,
  })

  await deliverChildReport(ctx, stream, { kind: 'stopped' })

  await scheduleCommandDrain(ctx, stream.sessionId)
}

function preserveStoppedStreamError(
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

export async function _prune(ctx: MutationCtx) {
  const streams = await ctx.db
    .query('streams')
    .withIndex('by_leaseExpiresAt', (q) => q.lt('leaseExpiresAt', Date.now()))
    .collect()

  for (const stream of streams) {
    await _fail(ctx, {
      streamId: stream._id,
      message: 'Stream interrupted before completion.',
    })
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

export async function stopForSession(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  options?: { suppressReport?: boolean },
) {
  await stopChildSessions(ctx, sessionId)

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

export async function remove(ctx: MutationCtx, streamId: Id<'streams'>) {
  const stream = await ctx.db.get(streamId)
  if (stream?.jobId) await ctx.scheduler.cancel(stream.jobId)
  if (stream) {
    await cleanUpOffloadedOutputs(ctx, streamId)
    await cleanUpGeneratedAttachments(ctx, streamId)
    await ctx.db.delete(streamId)
  }
}

async function reserveFollowUp(ctx: MutationCtx, stream: Doc<'streams'>) {
  const session = await ctx.db.get(stream.sessionId)
  if (!session) return

  const boundaryMessage = await earliestUnconsumedMessage(ctx, stream)
  if (!boundaryMessage) return

  await reserveInvokeTurn(ctx, {
    session,
    boundaryMessage,
    invokedBy: stream.invokedBy,
  })
}

/** The earliest user/sub-agent message the completed turn did not consume. */
async function earliestUnconsumedMessage(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
): Promise<Doc<'messages'> | null> {
  const boundary = stream.contextBoundaryCreationTime ?? 0

  const lateUserMessage = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_senderType', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .eq('sender.type', 'user')
        .gt('_creationTime', boundary),
    )
    .filter(notACommandChip)
    .order('asc')
    .first()

  // Sub-agent reports
  const lateReport = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_senderType', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .eq('sender.type', 'agent')
        .gt('_creationTime', boundary),
    )
    .filter((q) => q.eq(q.field('role'), 'user'))
    .order('asc')
    .first()

  if (!lateUserMessage || !lateReport) return lateUserMessage ?? lateReport
  return lateUserMessage._creationTime < lateReport._creationTime
    ? lateUserMessage
    : lateReport
}

type ReserveInvokeTurnArgs = {
  session: Doc<'sessions'>
  boundaryMessage: Doc<'messages'>
  invokedBy: Id<'users'>
}

/**
 * Reserves and schedules a fresh invoke turn for the session's active agent,
 * with the given message as the context boundary. Used for follow-ups on
 * unconsumed user messages and for waking a parent on a sub-agent report.
 */
export async function reserveInvokeTurn(
  ctx: MutationCtx,
  { session, boundaryMessage, invokedBy }: ReserveInvokeTurnArgs,
) {
  if (session.settings?.disabled || !session.activeAgentId) return

  const agent = await ctx.db.get(session.activeAgentId)
  if (!agent) return

  const agentSettings = await getSettingsByOwnerId(ctx, agent.ownerId)

  const link = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', session._id).eq('agentId', agent._id),
    )
    .unique()
  if (!link) return

  await injectModeNote(ctx, session, invokedBy)
  await injectDueReminders(ctx, session, invokedBy)
  await bumpTurnCount(ctx, session._id)

  const { messageId: processingMessageId, contentId } = await insertMessage(
    ctx,
    {
      sessionId: session._id,
      sender: { type: 'agent', id: agent._id },
      role: 'assistant',
      senderSnapshot: {
        name: agent.name,
        avatarId: agent.avatarId,
        css: agent.customCss,
        theme: agent.theme ?? agentSettings?.theme,
      },
      status: 'processing',
    },
    [],
  )

  const nextStreamId = await ctx.db.insert('streams', {
    sessionId: session._id,
    agentId: agent._id,
    invokedBy,
    processingMessageId,
    processingContentId: contentId,
    contextBoundaryMessageId: boundaryMessage._id,
    contextBoundaryCreationTime: boundaryMessage._creationTime,
    operation: 'invoke',
    blocking: false,
    status: 'pending',
    attempt: 0,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
  })

  const jobId = await ctx.scheduler.runAfter(
    0,
    internal.actions.streams._stream,
    { streamId: nextStreamId },
  )

  await ctx.db.patch(nextStreamId, { jobId })
}
