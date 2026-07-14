import type { Doc, Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../../functions'
import { getActiveStream, requireMember } from '../session/memberships'
import { stopForSession } from '../stream/lifecycle'

export type SubagentSummary = {
  sessionId: Id<'sessions'>
  title: string | null
  agentName: string | null
  avatarId?: Id<'avatars'>
  status: Doc<'streams'>['status']
  startedAt: number
}

async function runningChildren(
  ctx: AuthQueryCtx | AuthMutationCtx,
  sessionId: Id<'sessions'>,
) {
  return ctx.db
    .query('sessions')
    .withIndex('by_parentSessionId', (q) => q.eq('parent.sessionId', sessionId))
    .collect()
}

/**
 * Live list of a session's background sub-agents that are still running (for
 * the subagents widget).
 */
export async function list(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
): Promise<SubagentSummary[]> {
  await requireMember(ctx, sessionId, ctx.userId)

  const children = await runningChildren(ctx, sessionId)
  const summaries: SubagentSummary[] = []

  for (const child of children) {
    const stream = await getActiveStream(ctx, child._id)
    if (!stream) continue

    const agent = child.activeAgentId
      ? await ctx.db.get(child.activeAgentId)
      : null

    summaries.push({
      sessionId: child._id,
      title: child.title ?? null,
      agentName: agent?.name ?? null,
      avatarId: agent?.avatarId,
      status: stream.status,
      startedAt: stream._creationTime,
    })
  }

  return summaries.sort((a, b) => a.startedAt - b.startedAt)
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
  const children = await runningChildren(ctx, sessionId)
  for (const child of children) {
    await stopForSession(ctx, child._id, { suppressReport: true })
  }
}
