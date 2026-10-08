import type { Id } from '../_generated/dataModel'
import type { AuthQueryCtx } from '../functions'
import { getMember } from './session/memberships'
import { getByOwnerId } from './settings'

type AppearanceArgs = {
  agentId: Id<'agents'>
  sessionId?: Id<'sessions'>
}

/** Reads live styling for an owned agent or one visible in the session. */
export async function get(ctx: AuthQueryCtx, args: AppearanceArgs) {
  const agent = await ctx.db.get(args.agentId)
  if (!agent) return null
  if (agent.ownerId !== ctx.userId && !(await canReadInSession(ctx, args))) {
    return null
  }

  const settings = await getByOwnerId(ctx, agent.ownerId)
  return {
    customCss: agent.customCss,
    theme: agent.theme ?? settings?.theme,
    codeBlockHighlighting: agent.codeBlockHighlighting,
    codeBlockLineNumbers: agent.codeBlockLineNumbers,
  }
}

/** Keeps historical senders readable after they are unlinked. */
async function canReadInSession(
  ctx: AuthQueryCtx,
  { agentId, sessionId }: AppearanceArgs,
): Promise<boolean> {
  if (!sessionId || !(await getMember(ctx, sessionId, ctx.userId))) return false

  const linked = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', sessionId).eq('agentId', agentId),
    )
    .unique()
  if (linked) return true

  const message = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_sender', (q) =>
      q
        .eq('sessionId', sessionId)
        .eq('sender.type', 'agent')
        .eq('sender.id', agentId),
    )
    .first()
  return message !== null
}
