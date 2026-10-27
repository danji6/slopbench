import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { StreamCommand } from '../../types'
import { addVersion, getActiveSegmentRow } from '../messageContents'
import { scheduleTitle, stripMessageError } from '../messages'
import { getSessionWithWorkspace } from '../session/folderContext'
import * as Memberships from '../session/memberships'
import { assertAgentAvailable } from '../skills/access'
import { scheduleStream } from '../stream/execution'
import { STREAM_LEASE_MS } from '../stream/lifecycle'
import { agentIdentity } from './identities'

type ReserveStreamArgs = {
  sessionId: Id<'sessions'>
  agentId: Id<'agents'>
  invokedBy: Id<'users'>
  boundaryId?: Id<'messages'>
  command: Exclude<StreamCommand, { kind: 'retry' }>
  delayMs?: number
}

export async function reserveStream(ctx: MutationCtx, args: ReserveStreamArgs) {
  if (await Memberships.getActiveStream(ctx, args.sessionId)) return null

  const link = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', args.sessionId).eq('agentId', args.agentId),
    )
    .unique()
  if (!link) error('Active agent is not linked', 409)

  const agent = await ctx.db.get(args.agentId)
  if (!agent) error('Agent not found', 404)
  await assertAgentAvailable(ctx, agent._id)

  const session = await getSessionWithWorkspace(ctx, args.sessionId)
  if (session?.contextLock) error('Folder sources are being updated', 409)

  const boundary = args.boundaryId ? await ctx.db.get(args.boundaryId) : null
  const delayMs = args.delayMs ?? 0

  // Snapshot plan mode for regular invocations
  const command =
    args.command.kind === 'invoke'
      ? {
          ...args.command,
          mode: session?.mode === 'plan' ? session.mode : undefined,
        }
      : args.command

  const streamId = await ctx.db.insert('streams', {
    generation: 0,
    sessionId: args.sessionId,
    agentId: args.agentId,
    invokedBy: args.invokedBy,
    contextBoundaryMessageId: boundary?._id,
    contextBoundaryCreationTime: boundary?._creationTime,
    command,
    state: { phase: 'reserved' },
    attempt: 0,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
  })

  await scheduleStream(ctx, streamId, {
    delayMs,
    fireAt: delayMs > 0 ? Date.now() + delayMs : undefined,
  })

  return streamId
}

type TurnReservation = {
  session: Doc<'sessions'>
  /** The message the turn should read up to. */
  messageId: Id<'messages'>
  invokedBy: Id<'users'>
  silent: boolean
  activeStream: Doc<'streams'> | null
}

/**
 * Reserves the agent turn a completed user message should trigger, extending
 * the debounce of an already pending one instead. Falls back to scheduling
 * title generation when no turn is expected.
 */
export async function reserveOrDebounceTurn(
  ctx: MutationCtx,
  { session, messageId, invokedBy, silent, activeStream }: TurnReservation,
) {
  const debounceMs = session.settings?.agentDebounceMs ?? 0
  const willStream =
    Boolean(activeStream) || (!silent && Boolean(session.activeAgentId))

  if (!silent && session.activeAgentId && !activeStream) {
    await reserveStream(ctx, {
      sessionId: session._id,
      agentId: session.activeAgentId,
      invokedBy,
      boundaryId: messageId,
      command: { kind: 'invoke' },
      delayMs: debounceMs,
    })
  } else if (activeStream?.command.kind === 'compact') {
    const command = activeStream.command
    const followUpAfterCompact = command.followUpAfterCompact || !silent
    // Keep arrivals out of the summary and wake the agent after compaction
    await ctx.db.patch(activeStream._id, {
      command: {
        ...command,
        preserveContextBoundary: true,
        followUpAfterCompact,
      },
    })
  } else if (canDebounceInvoke(activeStream)) {
    // New messages reschedule the pending turn so the claim reads up to them
    await rescheduleStream(ctx, activeStream, {
      boundaryId: messageId,
      delayMs: debounceMs,
    })
  }

  if (!willStream) await scheduleTitle(ctx, session._id)
}

/** Identifies a queued invocation whose context can still absorb new messages. */
function canDebounceInvoke(
  stream: Doc<'streams'> | null,
): stream is Doc<'streams'> {
  if (!stream) return false
  return stream.state.phase === 'pending' && stream.command.kind === 'invoke'
}

/** Reschedules a pending stream invocation (debounce). */
export async function rescheduleStream(
  ctx: MutationCtx,
  stream: Pick<Doc<'streams'>, '_id'>,
  { boundaryId, delayMs }: { boundaryId: Id<'messages'>; delayMs: number },
) {
  const boundary = await ctx.db.get(boundaryId)

  await scheduleStream(ctx, stream._id, {
    delayMs,
    fireAt: Date.now() + delayMs,
  })

  await ctx.db.patch(stream._id, {
    contextBoundaryMessageId: boundaryId,
    contextBoundaryCreationTime: boundary?._creationTime,
  })
}

type ReserveMessageStreamArgs = {
  sessionId: Id<'sessions'>
  agentId: Id<'agents'>
  invokedBy: Id<'users'>
  messageId: Id<'messages'>
  boundaryId?: Id<'messages'>
}

type ReserveResumableStreamArgs = ReserveMessageStreamArgs & {
  suppressFollowUp?: boolean
}

export async function reserveResumableStream(
  ctx: MutationCtx,
  args: ReserveResumableStreamArgs,
) {
  if (await Memberships.getActiveStream(ctx, args.sessionId)) return null

  const link = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', args.sessionId).eq('agentId', args.agentId),
    )
    .unique()
  if (!link) error('Original agent is not linked', 409)

  const agent = await ctx.db.get(args.agentId)
  if (!agent) error('Agent not found', 404)
  await assertAgentAvailable(ctx, agent._id)

  const session = await getSessionWithWorkspace(ctx, args.sessionId)

  const [boundary, message] = await Promise.all([
    args.boundaryId ? ctx.db.get(args.boundaryId) : null,
    ctx.db.get(args.messageId),
  ])
  if (!message) error('Message not found', 404)

  // Resume into the last segment of the selected version
  const active = await getActiveSegmentRow(ctx, message)

  await ctx.db.patch(args.messageId, {
    status: 'processing',
    activeSegmentIndex: active?.segmentIndex ?? 0,
    metadata: stripMessageError(message.metadata),
  })
  if (active) {
    await ctx.db.patch(active._id, {
      metadata: stripMessageError(active.metadata),
    })
  }

  const streamId = await ctx.db.insert('streams', {
    generation: 0,
    sessionId: args.sessionId,
    agentId: args.agentId,
    invokedBy: args.invokedBy,
    state: {
      phase: 'reserved',
      processingMessageId: args.messageId,
      processingContentId: active?._id,
    },
    contextBoundaryMessageId: boundary?._id,
    contextBoundaryCreationTime: boundary?._creationTime,
    command: {
      kind: 'invoke',
      mode: session?.mode === 'plan' ? session.mode : undefined,
    },
    attempt: 0,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
    suppressFollowUp: args.suppressFollowUp,
  })

  await scheduleStream(ctx, streamId)
  return streamId
}

export async function reserveRetryStream(
  ctx: MutationCtx,
  args: ReserveMessageStreamArgs,
) {
  if (await Memberships.getActiveStream(ctx, args.sessionId)) return null

  const link = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', args.sessionId).eq('agentId', args.agentId),
    )
    .unique()
  if (!link) error('Original agent is not linked', 409)

  const agent = await ctx.db.get(args.agentId)
  if (!agent) error('Agent not found', 404)
  await assertAgentAvailable(ctx, agent._id)

  const [boundary, message] = await Promise.all([
    args.boundaryId ? ctx.db.get(args.boundaryId) : null,
    ctx.db.get(args.messageId),
  ])
  if (!message) error('Message not found', 404)

  const retryPreviousVersion = message.selectedVersion
  // Append a fresh version to regenerate into
  const { contentId } = await addVersion(ctx, {
    message,
    identity: agentIdentity(agent),
  })
  await ctx.db.patch(args.messageId, {
    status: 'processing',
    activeSegmentIndex: 0,
  })

  const streamId = await ctx.db.insert('streams', {
    generation: 0,
    sessionId: args.sessionId,
    agentId: args.agentId,
    invokedBy: args.invokedBy,
    state: {
      phase: 'reserved',
      processingMessageId: args.messageId,
      processingContentId: contentId,
    },
    contextBoundaryMessageId: boundary?._id,
    contextBoundaryCreationTime: boundary?._creationTime,
    command: { kind: 'retry', previousVersion: retryPreviousVersion },
    attempt: 0,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
    suppressFollowUp: true,
  })

  await scheduleStream(ctx, streamId)
  return streamId
}

export async function latestMessageId(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  return (
    await ctx.db
      .query('messages')
      .withIndex('by_sessionId_status_contextEligible', (q) =>
        q
          .eq('sessionId', sessionId)
          .eq('status', 'done')
          .eq('contextEligible', true),
      )
      .order('desc')
      .first()
  )?._id
}
