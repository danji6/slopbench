import type { Id } from '../../_generated/dataModel'
import type { AuthMutationCtx, AuthQueryCtx } from '../../functions'

type UsageShape = { inputTokens?: number } | undefined

/** Input tokens sent on a session's most recent request. */
export async function lastRequestInputTokens(
  ctx: AuthQueryCtx | AuthMutationCtx,
  sessionId: Id<'sessions'>,
): Promise<number | null> {
  const recent = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .order('desc')
    .take(10)

  for (const message of recent) {
    const usage = message.metadata?.usage as UsageShape
    if (usage?.inputTokens != null) return usage.inputTokens
  }

  return null
}
