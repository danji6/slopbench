import { orderContextNotes } from '@sb/core/context-notes'
import { isKnownTextFile } from '@sb/core/workspace/files'

import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { AuthQueryCtx } from '../../functions'
import { minRole } from '../../lib/roles'
import { sharedSessionId } from '../../lib/subagent'
import type { StreamExecutionArgs } from '../../types'
import { resolveSpawnableAgents } from '../agent/subagents'
import {
  activeAttachmentMessages,
  hasLoadedAttachmentMedia,
} from '../attachmentMedia'
import { resolve as resolveMcpServers } from '../mcp'
import {
  getProcessingSegmentRow,
  withParts,
  withPartsMany,
} from '../messageContents'
import { getBySession as getPlan } from '../plans'
import { resolveSets as resolvePromptSets } from '../prompts'
import { resolve as resolveProviders } from '../providers'
import { getBySessionAgent as getSessionCache } from '../session/cache'
import { getSessionWithWorkspace } from '../session/folderContext'
import { countParticipants, getMembership } from '../session/memberships'
import { getApprovals, getState } from '../session/state'
import { getByOwnerId as getSettings } from '../settings'
import { agentWithHome } from '../skills/homes'
import { ownsExecution } from './execution'

/** Returns a list of session ids that have ongoing streams. */
export async function activeSessionIds(
  ctx: AuthQueryCtx,
): Promise<Id<'sessions'>[]> {
  const streams = await ctx.db.query('streams').collect()
  const sessionIds = [...new Set(streams.map((stream) => stream.sessionId))]

  const visible = await Promise.all(
    sessionIds.map(async (sessionId) =>
      (await getMembership(ctx, sessionId, ctx.userId)) ? sessionId : null,
    ),
  )

  return visible.filter((id): id is Id<'sessions'> => id !== null)
}

export async function _getContext(
  ctx: QueryCtx,
  { streamId, generation }: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(streamId)
  if (!ownsExecution(stream, { streamId, generation })) return null

  const [session, agent, invoker, output] = await Promise.all([
    getSessionWithWorkspace(ctx, stream.sessionId),
    agentWithHome(ctx, stream.agentId),
    ctx.db.get(stream.invokedBy),
    ctx.db.get(stream.state.processingMessageId),
  ])
  if (!session || !agent || !invoker || !output) return null

  const owner = await ctx.db.get(agent.ownerId)
  if (!owner) return null

  // The engine loop only ever sees the active segment's parts
  const outputRow = await getProcessingSegmentRow(ctx, stream)

  const [
    settings,
    invokerSettings,
    participants,
    plan,
    prompts,
    mcpServers,
    modelProviders,
    hasActiveMedia,
  ] = await Promise.all([
    getSettings(ctx, agent.ownerId),
    getSettings(ctx, invoker._id),
    countParticipants(ctx, stream.sessionId),
    // Sub-agents can see and edit the parent's plan
    getPlan(ctx, sharedSessionId(session)),
    resolvePromptSets(ctx, agent),
    resolveMcpServers(ctx, agent.ownerId, { withCredentials: true }),
    resolveProviders(ctx, agent.ownerId),
    getActiveMediaState(ctx, stream),
  ])

  // Sub-agent sessions never spawn further sub-agents (flat only)
  const invocation =
    stream.command.kind === 'invoke' || stream.command.kind === 'retry'
  const spawnableAgents =
    invocation && !session.parent
      ? await resolveSpawnableAgents(ctx, agent)
      : []

  const sessionCache = invocation
    ? await getSessionCache(
        ctx,
        stream.sessionId,
        stream.agentId,
        minRole(invoker.role, 'admin'),
      )
    : null

  const state = await getState(ctx, stream.sessionId)

  return {
    sessionCache,
    hasActiveMedia,
    environment: state?.environment ?? {},
    toolApprovals: await getApprovals(ctx, stream.sessionId),
    spawnableAgents,
    stream,
    session,
    agent,
    invoker,
    invokerSettings,
    owner,
    ownerSettings: settings,
    output: { ...output, parts: outputRow?.parts ?? [] },
    settings,
    prompts,
    mcpServers,
    modelProviders,
    plan,
    ...participants,
  }
}

export async function _getProviderHistory(
  ctx: QueryCtx,
  { streamId, generation }: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(streamId)
  if (!ownsExecution(stream, { streamId, generation })) return []

  const summary = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_type_status', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .eq('type', 'summary')
        .eq('status', 'done'),
    )
    .filter((q) => q.eq(q.field('contextEligible'), true))
    .order('desc')
    .first()

  const upper = stream.contextBoundaryCreationTime ?? Number.MAX_SAFE_INTEGER
  const summaryFloor = summary
    ? (summary.summaryBoundaryCreationTime ?? summary._creationTime)
    : 0
  const summaryApplies = summary !== null && summaryFloor <= upper

  const messages = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_status_contextEligible', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .eq('status', 'done')
        .eq('contextEligible', true)
        .gt('_creationTime', summaryApplies ? summaryFloor : 0)
        .lte('_creationTime', upper),
    )
    .order('asc')
    .collect()

  const ordered = summaryApplies
    ? [summary, ...messages.filter((message) => message._id !== summary._id)]
    : messages

  for (const id of [
    stream.workspaceContextMessageId,
    stream.skillContextMessageId,
    stream.mcpContextMessageId,
  ]) {
    if (!id || ordered.some((message) => message._id === id)) continue
    const note = await ctx.db.get(id)
    if (note?.contextEligible) ordered.push(note)
  }

  const visible = ordered.filter(
    (message) => message.type !== 'mcp' || message.sender.id === stream.agentId,
  )
  const history = await withPartsMany(ctx, visible)

  // The in-flight turn joins the history with all its segments concatenated
  // (sealed split segments are only reachable through the processing doc)
  const current = stream.state.processingMessageId
    ? await ctx.db.get(stream.state.processingMessageId)
    : null

  const includesProcessingMessage =
    stream.command.kind === 'invoke' || stream.command.kind === 'retry'
  if (current && includesProcessingMessage) {
    const joined = await withParts(ctx, current)
    if (joined.parts.length > 0) {
      history.push(joined)
    }
  }

  return orderContextNotes(history)
}

export async function _isActive(
  ctx: QueryCtx,
  { streamId, generation }: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(streamId)
  return ownsExecution(stream, { streamId, generation })
}

/** Detects media loaded anywhere in the active debounced turn or tool step. */
async function getActiveMediaState(ctx: QueryCtx, stream: Doc<'streams'>) {
  const processing = stream.state.processingMessageId
    ? await ctx.db.get(stream.state.processingMessageId)
    : null
  if (processing) {
    const joined = await withParts(ctx, processing)
    if (hasLoadedAttachmentMedia(joined.parts)) return true
  }

  if (!stream.contextBoundaryMessageId) return false

  const history = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .lte(
          '_creationTime',
          stream.contextBoundaryCreationTime ?? Number.MAX_SAFE_INTEGER,
        ),
    )
    .order('asc')
    .collect()

  const activeIds = activeAttachmentMessages(
    history,
    stream.contextBoundaryMessageId,
  )
  if (activeIds.size === 0) return false

  const attachments = await Promise.all(
    [...activeIds].map((messageId) =>
      ctx.db
        .query('attachments')
        .withIndex('by_messageId', (q) => q.eq('messageId', messageId))
        .collect(),
    ),
  )

  return attachments
    .flat()
    .some(
      (attachment) =>
        !isKnownTextFile(attachment.mediaType, attachment.filename),
    )
}

export async function _hasActiveMedia(
  ctx: QueryCtx,
  { streamId, generation }: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(streamId)
  return ownsExecution(stream, { streamId, generation })
    ? getActiveMediaState(ctx, stream)
    : false
}

/** Reads stop state without putting ordinary seam checks in a mutation's read set. */
export async function _getStopState(
  ctx: QueryCtx,
  { streamId, generation }: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(streamId)
  if (!ownsExecution(stream, { streamId, generation }))
    return 'stopped' as const
  return stream.stopAt ? ('requested' as const) : ('active' as const)
}
