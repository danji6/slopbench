import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { getSegmentRow, setSegmentParts } from '../messageContents'
import { countParticipants } from '../session/memberships'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'

type EvalTarget = {
  messageId: Id<'messages'>
  version: number
  segmentIndex: number
}

export async function _getMessageEvalContext(
  ctx: QueryCtx,
  {
    messageId,
    invokerId,
    version,
    segmentIndex,
  }: EvalTarget & {
    invokerId: Id<'users'>
  },
) {
  const message = await ctx.db.get(messageId)
  if (!message) return null

  const row = await getSegmentRow(ctx, messageId, version, segmentIndex)
  if (!row) return null

  const session = await ctx.db.get(message.sessionId)
  if (!session?.activeAgentId) return null

  const [agent, invoker] = await Promise.all([
    ctx.db.get(session.activeAgentId),
    ctx.db.get(invokerId),
  ])
  if (!agent || !invoker) return null

  const owner = await ctx.db.get(agent.ownerId)
  if (!owner) return null

  const [invokerSettings, ownerSettings, participants] = await Promise.all([
    getSettingsByOwnerId(ctx, invoker._id),
    getSettingsByOwnerId(ctx, owner._id),
    countParticipants(ctx, message.sessionId),
  ])

  return {
    message: { ...message, parts: row.parts },
    session,
    agent,
    invoker,
    invokerSettings,
    owner,
    ownerSettings,
    ...participants,
  }
}

export async function _applyMessageEval(
  ctx: MutationCtx,
  {
    messageId,
    version,
    segmentIndex,
    parts,
    environment,
    dirty,
  }: EvalTarget & {
    parts: unknown[]
    environment: Record<string, unknown>
    dirty: boolean
  },
) {
  const message = await ctx.db.get(messageId)
  if (!message) return

  const row = await getSegmentRow(ctx, messageId, version, segmentIndex)
  if (!row) return

  await setSegmentParts(ctx, message, row, parts)

  if (dirty) {
    await ctx.db.patch(message.sessionId, { environment })
  }
}
