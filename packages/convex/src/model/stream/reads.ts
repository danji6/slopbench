import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { AuthQueryCtx } from '../../functions'
import { sharedSessionId } from '../../lib/subagent'
import { resolveSpawnableAgents } from '../agent/subagents'
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
import { countParticipants, getMembership } from '../session/memberships'
import { getState } from '../session/state'
import { getByOwnerId as getSettings } from '../settings'

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
  { streamId }: { streamId: Id<'streams'> },
) {
  const stream = await ctx.db.get(streamId)
  if (!stream || !stream.processingMessageId) return null

  const [session, agent, invoker, output] = await Promise.all([
    ctx.db.get(stream.sessionId),
    ctx.db.get(stream.agentId),
    ctx.db.get(stream.invokedBy),
    ctx.db.get(stream.processingMessageId),
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
  ] = await Promise.all([
    getSettings(ctx, agent.ownerId),
    getSettings(ctx, invoker._id),
    countParticipants(ctx, stream.sessionId),
    // Sub-agents can see and edit the parent's plan
    getPlan(ctx, sharedSessionId(session)),
    resolvePromptSets(ctx, agent),
    resolveMcpServers(ctx, agent.ownerId, { withCredentials: true }),
    resolveProviders(ctx, agent.ownerId),
  ])

  // Sub-agent sessions never spawn further sub-agents (flat only)
  const invocation =
    stream.operation === 'invoke' || stream.operation === 'retry'
  const spawnableAgents =
    invocation && !session.parent
      ? await resolveSpawnableAgents(ctx, agent)
      : []

  const sessionCache = invocation
    ? await getSessionCache(ctx, stream.sessionId, stream.agentId)
    : null

  const state = await getState(ctx, stream.sessionId)

  return {
    sessionCache,
    environment: state?.environment ?? {},
    toolApprovals: state?.toolApprovals,
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
  { streamId }: { streamId: Id<'streams'> },
) {
  const stream = await ctx.db.get(streamId)
  if (!stream) return []

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
  const history = await withPartsMany(ctx, ordered)

  // The in-flight turn joins the history with all its segments concatenated
  // (sealed split segments are only reachable through the processing doc)
  const current = stream.processingMessageId
    ? await ctx.db.get(stream.processingMessageId)
    : null

  if (
    current &&
    (stream.operation === 'invoke' || stream.operation === 'retry')
  ) {
    const joined = await withParts(ctx, current)
    if (joined.parts.length > 0) {
      history.push(joined)
    }
  }

  return history
}

export async function _isActive(
  ctx: QueryCtx,
  { streamId }: { streamId: Id<'streams'> },
) {
  const stream = await ctx.db.get(streamId)
  return !!stream && stream.status !== 'stopping'
}
