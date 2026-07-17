import type { Doc, Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../../functions'
import { getActiveStream, requireMember } from '../session/memberships'
import { stopForSession } from '../stream/lifecycle'
import { lastRequestInputTokens } from './usage'

export type SubagentSummary = {
  sessionId: Id<'sessions'>
  title: string | null
  agentName: string | null
  avatarId?: Id<'avatars'>
  /** Whether the child still has an active stream. */
  running: boolean
  /** Active stream status, null once the child turn settled. */
  status: Doc<'streams'>['status'] | null
  startedAt: number
  /** Input tokens on the child session's most recent request. */
  tokens: number | null
}

async function childSessions(
  ctx: AuthQueryCtx | AuthMutationCtx,
  sessionId: Id<'sessions'>,
) {
  return ctx.db
    .query('sessions')
    .withIndex('by_parentSessionId', (q) => q.eq('parent.sessionId', sessionId))
    .collect()
}

/**
 * Live list of a session's background sub-agents, running and settled (for
 * the subagents widget).
 */
export async function list(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
): Promise<SubagentSummary[]> {
  await requireMember(ctx, sessionId, ctx.userId)

  const children = await childSessions(ctx, sessionId)
  const summaries: SubagentSummary[] = []

  for (const child of children) {
    const stream = await getActiveStream(ctx, child._id)
    const agent = child.activeAgentId
      ? await ctx.db.get(child.activeAgentId)
      : null

    summaries.push({
      sessionId: child._id,
      title: child.title ?? null,
      agentName: agent?.name ?? null,
      avatarId: agent?.avatarId,
      running: Boolean(stream),
      status: stream?.status ?? null,
      startedAt: child._creationTime,
      tokens: await lastRequestInputTokens(ctx, child._id),
    })
  }

  // Newest first
  return summaries.sort((a, b) => b.startedAt - a.startedAt)
}

async function requireChild(
  ctx: AuthMutationCtx,
  sessionId: Id<'sessions'>,
  childSessionId: Id<'sessions'>,
) {
  await requireMember(ctx, sessionId, ctx.userId)
  const child = await ctx.db.get(childSessionId)
  if (child?.parent?.sessionId !== sessionId) error('Not found', 404)
}

/** Stops a single sub-agent, silently. Doesn't wake the parent. */
export async function stop(
  ctx: AuthMutationCtx,
  {
    sessionId,
    childSessionId,
  }: { sessionId: Id<'sessions'>; childSessionId: Id<'sessions'> },
) {
  await requireChild(ctx, sessionId, childSessionId)
  await stopForSession(ctx, childSessionId, { suppressReport: true })
}

/** Stops every running sub-agent at once, silently. Doesn't wake the parent. */
export async function stopAll(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  await requireMember(ctx, sessionId, ctx.userId)
  const children = await childSessions(ctx, sessionId)
  for (const child of children) {
    await stopForSession(ctx, child._id, { suppressReport: true })
  }
}
