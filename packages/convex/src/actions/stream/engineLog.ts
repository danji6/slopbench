'use node'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import type { StreamExecutionArgs } from '../../types'

export async function storeSessionLogBody(ctx: ActionCtx, body: string) {
  return ctx.storage.store(new Blob([body], { type: 'application/json' }))
}

export function buildSessionLogBody({
  requestBody,
  responseBody,
}: {
  requestBody?: string
  responseBody?: string
}) {
  return JSON.stringify({ requestBody, responseBody }, null, 2)
}

export async function patchSessionLogBody(
  ctx: ActionCtx,
  {
    body,
    execution,
  }: {
    body: string
    execution: StreamExecutionArgs
  },
) {
  const storageId = await storeSessionLogBody(ctx, body)
  try {
    await ctx.runMutation(internal.streams._saveLog, {
      ...execution,
      storageId,
    })
  } catch (err) {
    await ctx.storage.delete(storageId).catch(() => {})
    throw err
  }
}
