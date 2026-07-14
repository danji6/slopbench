'use node'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { partsHaveScript } from '../../model/messages'
import { postSidecar } from '../../model/sidecar'
import { buildEvalContext } from './evalContext'

type MessageEvalResult = {
  parts: unknown[]
  environment: Record<string, unknown>
  dirty: boolean
}

/** Runs script evaluation on one segment of the given message. */
export async function _evalMessage(
  ctx: ActionCtx,
  {
    messageId,
    invokerId,
    version,
    segmentIndex,
  }: {
    messageId: Id<'messages'>
    invokerId: Id<'users'>
    version: number
    segmentIndex: number
  },
) {
  const data = await ctx.runQuery(internal.chat._getMessageEvalContext, {
    messageId,
    invokerId,
    version,
    segmentIndex,
  })
  if (!data) return

  const {
    message,
    session,
    agent,
    invoker,
    invokerSettings,
    owner,
    ownerSettings,
    userCount,
    agentCount,
  } = data
  if (!partsHaveScript(message.parts)) return

  const context = await buildEvalContext({
    agent,
    invoker,
    invokerSettings,
    owner,
    ownerSettings,
    session,
    userCount,
    agentCount,
  })

  const result = await postSidecar<MessageEvalResult>('/eval/message', {
    parts: message.parts,
    context,
    environment: (session.environment as Record<string, unknown>) ?? {},
  })

  await ctx.runMutation(internal.chat._applyMessageEval, {
    messageId,
    version,
    segmentIndex,
    parts: result.parts,
    environment: result.environment,
    dirty: result.dirty,
  })
}
