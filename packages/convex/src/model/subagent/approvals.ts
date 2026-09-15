import type { Id } from '../../_generated/dataModel'
import type { AuthQueryCtx } from '../../functions'
import { hasPendingToolApprovals } from '../chat/approvals'
import { getProcessingSegmentRow } from '../messageContents'
import { getActiveStream, requireMember } from '../session/memberships'
import { getApprovals } from '../session/state'

/** Lists child approval requests for members of the main session. */
export async function pendingApprovals(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  await requireMember(ctx, sessionId, ctx.userId)
  const children = await ctx.db
    .query('sessions')
    .withIndex('by_parentSessionId', (q) => q.eq('parent.sessionId', sessionId))
    .collect()

  const pending = await Promise.all(
    children.map(async (child) => {
      const stream = await getActiveStream(ctx, child._id)
      if (stream?.status !== 'awaiting_approval') return null
      const row = await getProcessingSegmentRow(ctx, stream)
      if (!row || !hasPendingToolApprovals(row.parts)) return null
      const agent = await ctx.db.get(stream.agentId)
      return {
        sessionId: child._id,
        title: child.title,
        agentName: agent?.name ?? 'Sub-agent',
        mode: child.mode,
        toolApprovals: await getApprovals(ctx, child._id),
        parts: row.parts.filter((part) => hasPendingToolApprovals([part])),
      }
    }),
  )
  return pending.filter((request) => request !== null)
}
