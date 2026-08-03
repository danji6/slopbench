import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { resolve as resolveMcpServers } from '../mcp'
import { getSegmentRow, setSegmentParts } from '../messageContents'
import { countParticipants } from '../session/memberships'
import { getState, patchState } from '../session/state'
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

  const [invokerSettings, ownerSettings, participants, mcpServers] =
    await Promise.all([
      getSettingsByOwnerId(ctx, invoker._id),
      getSettingsByOwnerId(ctx, owner._id),
      countParticipants(ctx, message.sessionId),
      resolveMcpServers(ctx, owner._id),
    ])

  return {
    message: { ...message, parts: row.parts },
    session,
    environment: (await getState(ctx, message.sessionId))?.environment ?? {},
    agent,
    invoker,
    invokerSettings,
    owner,
    ownerSettings,
    mcpServers,
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
    await patchState(ctx, message.sessionId, { environment })
  }
}
