import type { Doc, Id } from '../../_generated/dataModel'
import type { AuthQueryCtx } from '../../functions'
import { getActiveStream, getMembership } from '../session/memberships'
import { lastRequestInputTokens } from './usage'

export type SubagentWatch = {
  title: string | null
  /** Active stream status, null once the child turn settled. */
  status: Doc<'streams'>['status'] | null
  agent: { name: string; avatarId?: Id<'avatars'> } | null
  /** Input tokens on the child session's most recent request. */
  tokens: number | null
}

/**
 * Small live view of a sub-agent child session for the parent's task tool
 * part: title, agent identity, stream status, and token usage.
 */
export async function watch(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
): Promise<SubagentWatch | null> {
  const session = await ctx.db.get(sessionId)
  if (!session?.parent) return null

  // Parent session members may watch even without a child membership row
  const membership =
    (await getMembership(ctx, sessionId, ctx.userId)) ??
    (await getMembership(ctx, session.parent.sessionId, ctx.userId))
  if (!membership) return null

  const agent = session.activeAgentId
    ? await ctx.db.get(session.activeAgentId)
    : null
  const stream = await getActiveStream(ctx, sessionId)

  return {
    title: session.title ?? null,
    status: stream?.status ?? null,
    agent: agent ? { name: agent.name, avatarId: agent.avatarId } : null,
    tokens: await lastRequestInputTokens(ctx, sessionId),
  }
}
