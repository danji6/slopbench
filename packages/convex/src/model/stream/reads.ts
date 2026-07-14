import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { AuthQueryCtx } from '../../functions'
import { sharedSessionId } from '../../lib/subagent'
import { resolveSpawnableAgents } from '../agent/subagents'
import {
  getProcessingSegmentRow,
  withParts,
  withPartsMany,
} from '../messageContents'
import { getBySession as getPlan } from '../plans'
import { countParticipants, getMembership } from '../session/memberships'
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

  const [settings, invokerSettings, participants, plan] = await Promise.all([
    getSettings(ctx, agent.ownerId),
    getSettings(ctx, invoker._id),
    countParticipants(ctx, stream.sessionId),
    // Sub-agents can see and edit the parent's plan
    getPlan(ctx, sharedSessionId(session)),
  ])

  // Sub-agent sessions never spawn further sub-agents (flat only)
  const invocation =
    stream.operation === 'invoke' || stream.operation === 'retry'
  const spawnableAgents =
    invocation && !session.parent
      ? await resolveSpawnableAgents(ctx, agent)
      : []

  return {
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
    .order('desc')
    .first()

  const messages = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_status_contextEligible', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .eq('status', 'done')
        .eq('contextEligible', true)
        .gte('_creationTime', summary?._creationTime ?? 0)
        .lte(
          '_creationTime',
          stream.contextBoundaryCreationTime ?? Number.MAX_SAFE_INTEGER,
        ),
    )
    .order('asc')
    .collect()

  const history = await withPartsMany(ctx, messages)

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
      history.sort((a, b) => a._creationTime - b._creationTime)
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
