import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import { addVersion, getActiveSegmentRow } from '../messageContents'
import { stripMessageError } from '../messages'
import { findModelEntry } from '../provider/providers'
import * as Memberships from '../session/memberships'
import { setMetadataModel } from '../session/metadata'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'
import { STREAM_LEASE_MS } from '../stream/lifecycle'
import { agentSenderSnapshot } from './identities'

export async function reserveStream(
  ctx: MutationCtx,
  args: {
    sessionId: Id<'sessions'>
    agentId: Id<'agents'>
    invokedBy: Id<'users'>
    boundaryId?: Id<'messages'>
    operation: 'invoke' | 'compact' | 'impersonate'
    instructions?: string
    delayMs?: number
  },
) {
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

  const agentSettings = await getSettingsByOwnerId(ctx, agent.ownerId)
  const session = await ctx.db.get(args.sessionId)
  const model = agent.modelId
    ? (findModelEntry(agentSettings?.modelProviders, agent.modelId) ?? {
        id: agent.modelId,
      })
    : undefined

  await ctx.db.patch(args.sessionId, {
    metadata: setMetadataModel(session?.metadata, model),
  })

  const boundary = args.boundaryId ? await ctx.db.get(args.boundaryId) : null
  const delayMs = args.delayMs ?? 0

  const streamId = await ctx.db.insert('streams', {
    sessionId: args.sessionId,
    agentId: args.agentId,
    invokedBy: args.invokedBy,
    contextBoundaryMessageId: args.boundaryId,
    contextBoundaryCreationTime: boundary?._creationTime,
    operation: args.operation,
    // Plan mode only applies to regular invocations, snapshotted per turn
    ...(args.operation === 'invoke' && session?.mode === 'plan'
      ? { mode: session.mode }
      : {}),
    blocking: args.operation === 'compact',
    instructions: args.instructions,
    status: 'pending',
    attempt: 0,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
    ...(delayMs > 0 ? { fireAt: Date.now() + delayMs } : {}),
  })

  const jobId = await ctx.scheduler.runAfter(
    delayMs,
    internal.actions.streams._stream,
    { streamId },
  )

  await ctx.db.patch(streamId, { jobId })
  return streamId
}

/** Reschedules a pending stream invocation (debounce). */
export async function rescheduleStream(
  ctx: MutationCtx,
  stream: { _id: Id<'streams'>; jobId?: Id<'_scheduled_functions'> },
  { boundaryId, delayMs }: { boundaryId: Id<'messages'>; delayMs: number },
) {
  if (stream.jobId) await ctx.scheduler.cancel(stream.jobId)

  const boundary = await ctx.db.get(boundaryId)
  const jobId = await ctx.scheduler.runAfter(
    delayMs,
    internal.actions.streams._stream,
    { streamId: stream._id },
  )

  await ctx.db.patch(stream._id, {
    jobId,
    fireAt: Date.now() + delayMs,
    contextBoundaryMessageId: boundaryId,
    contextBoundaryCreationTime: boundary?._creationTime,
  })
}

export async function reserveResumableStream(
  ctx: MutationCtx,
  args: {
    sessionId: Id<'sessions'>
    agentId: Id<'agents'>
    invokedBy: Id<'users'>
    messageId: Id<'messages'>
    boundaryId?: Id<'messages'>
    suppressFollowUp?: boolean
  },
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

  const agentSettings = await getSettingsByOwnerId(ctx, agent.ownerId)

  const session = await ctx.db.get(args.sessionId)

  const model = agent.modelId
    ? (findModelEntry(agentSettings?.modelProviders, agent.modelId) ?? {
        id: agent.modelId,
      })
    : undefined

  await ctx.db.patch(args.sessionId, {
    metadata: setMetadataModel(session?.metadata, model),
  })

  const [boundary, message] = await Promise.all([
    args.boundaryId ? ctx.db.get(args.boundaryId) : null,
    ctx.db.get(args.messageId),
  ])
  if (!message) error('Message not found', 404)

  // Resume into the last segment of the selected version
  const active = await getActiveSegmentRow(ctx, message)

  await ctx.db.patch(args.messageId, {
    status: 'processing',
    metadata: stripMessageError(message.metadata),
  })
  if (active) {
    await ctx.db.patch(active._id, {
      metadata: stripMessageError(active.metadata),
    })
  }

  const streamId = await ctx.db.insert('streams', {
    sessionId: args.sessionId,
    agentId: args.agentId,
    invokedBy: args.invokedBy,
    processingMessageId: args.messageId,
    processingContentId: active?._id,
    contextBoundaryMessageId: args.boundaryId,
    contextBoundaryCreationTime: boundary?._creationTime,
    operation: 'invoke',
    ...(session?.mode === 'plan' ? { mode: session.mode } : {}),
    blocking: false,
    status: 'pending',
    attempt: 0,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
    suppressFollowUp: args.suppressFollowUp,
  })

  const jobId = await ctx.scheduler.runAfter(
    0,
    internal.actions.streams._stream,
    { streamId },
  )

  await ctx.db.patch(streamId, { jobId })
  return streamId
}

export async function reserveRetryStream(
  ctx: MutationCtx,
  args: {
    sessionId: Id<'sessions'>
    agentId: Id<'agents'>
    invokedBy: Id<'users'>
    messageId: Id<'messages'>
    boundaryId?: Id<'messages'>
  },
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

  const agentSettings = await getSettingsByOwnerId(ctx, agent.ownerId)
  const session = await ctx.db.get(args.sessionId)

  const model = agent.modelId
    ? (findModelEntry(agentSettings?.modelProviders, agent.modelId) ?? {
        id: agent.modelId,
      })
    : undefined

  await ctx.db.patch(args.sessionId, {
    metadata: setMetadataModel(session?.metadata, model),
  })

  const [boundary, message] = await Promise.all([
    args.boundaryId ? ctx.db.get(args.boundaryId) : null,
    ctx.db.get(args.messageId),
  ])
  if (!message) error('Message not found', 404)

  // Append a fresh version to regenerate into
  const { contentId } = await addVersion(ctx, {
    message,
    senderSnapshot: agentSenderSnapshot(agent, agentSettings),
  })
  await ctx.db.patch(args.messageId, { status: 'processing' })

  const streamId = await ctx.db.insert('streams', {
    sessionId: args.sessionId,
    agentId: args.agentId,
    invokedBy: args.invokedBy,
    processingMessageId: args.messageId,
    processingContentId: contentId,
    contextBoundaryMessageId: args.boundaryId,
    contextBoundaryCreationTime: boundary?._creationTime,
    operation: 'retry',
    blocking: false,
    status: 'pending',
    attempt: 0,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
    suppressFollowUp: true,
  })

  const jobId = await ctx.scheduler.runAfter(
    0,
    internal.actions.streams._stream,
    { streamId },
  )

  await ctx.db.patch(streamId, { jobId })
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
