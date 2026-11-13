import { orderContextNotes } from '@cv/core/context-notes'
import { sha256 } from '@cv/core/sha256'
import { isKnownTextFile } from '@cv/core/workspace/files'

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
import { hasStoredMcpOutput } from '../tool/availabilityRead'
import { availableToolkits } from '../toolkits/access'
import { toolkitSkillFingerprint } from '../toolkits/skillContext'
import { ownsExecution } from './execution'
import {
  historyUpperBound,
  latestContextReset,
  resolveHistoryBoundary,
} from './historyBoundary'

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
    resolveMcpServers(ctx, agent.ownerId, {
      withCredentials: true,
      agentId: agent._id,
      sessionId: stream.sessionId,
    }),
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

  const sessionCache = await getSessionCache(
    ctx,
    stream.sessionId,
    stream.agentId,
    minRole(invoker.role, 'admin'),
  )

  const state = await getState(ctx, stream.sessionId)
  const toolkits = await availableToolkits(ctx, agent._id, stream.sessionId)

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
    toolkitContext: await Promise.all(
      toolkits.map(async (row) => ({
        id: row._id,
        name: row.name,
        fingerprint: await sha256(
          JSON.stringify([row.revision, row.skillsEnabled, row.disabledSkills]),
        ),
      })),
    ),
    toolkitSkillRevision: await toolkitSkillFingerprint(toolkits),
    toolkitCount: toolkits.length,
    hasStoredMcpOutput:
      invocation && agent.tools?.includes('mcp_access')
        ? await hasStoredMcpOutput(ctx, session._id, agent)
        : false,
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

  const { upper, floor, summary } = await resolveHistoryBoundary(ctx, stream)
  const messages = await listDoneHistory(ctx, stream.sessionId, floor, upper)

  const ordered = summary
    ? [summary, ...messages.filter((message) => message._id !== summary._id)]
    : messages

  const currentId = stream.state.processingMessageId
  if (currentId) {
    const notes = await ctx.db
      .query('messages')
      .withIndex('by_sessionId_contextAnchor', (q) =>
        q
          .eq('sessionId', stream.sessionId)
          .eq('extra.anchorMessageId', currentId),
      )
      .collect()
    for (const note of notes) {
      if (
        note.contextEligible &&
        note._creationTime > floor &&
        !ordered.some((message) => message._id === note._id)
      ) {
        ordered.push(note)
      }
    }
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

function listDoneHistory(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  floor: number,
  upper: number,
) {
  if (floor >= upper) return []
  return ctx.db
    .query('messages')
    .withIndex('by_sessionId_status_contextEligible', (q) =>
      q
        .eq('sessionId', sessionId)
        .eq('status', 'done')
        .eq('contextEligible', true)
        .gt('_creationTime', floor)
        .lte('_creationTime', upper),
    )
    .order('asc')
    .collect()
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

  const upper = historyUpperBound(stream)
  const reset = await latestContextReset(ctx, stream.sessionId, upper)
  if (reset?._creationTime === upper) return false

  const history = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .gt('_creationTime', reset?._creationTime ?? 0)
        .lte('_creationTime', upper),
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
