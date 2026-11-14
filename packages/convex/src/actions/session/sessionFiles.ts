'use node'

import { randomUUID } from 'node:crypto'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { error } from '../../errors'
import { getSubject } from '../../functions'

export async function duplicateSession(
  ctx: ActionCtx,
  args: { sessionId: Id<'sessions'>; title?: string },
): Promise<{ sessionId: Id<'sessions'> }> {
  const subject = await getSubject(ctx)
  const token = `${Date.now() + 5 * 60_000}:${randomUUID()}`
  const prepared = await ctx.runMutation(internal.sessions._beginDuplicate, {
    ...args,
    subject,
    token,
  })
  if (!prepared?.operationId)
    error('Session duplication could not be started', 409)

  const sessionId = await runSessionFileOperation(ctx, {
    operationId: prepared.operationId,
    immediate: true,
  })
  if (!sessionId) error('Session duplication did not complete', 409)
  return { sessionId }
}

export async function runSessionFileOperation(
  ctx: ActionCtx,
  args: { operationId: Id<'sessionFileOperations'>; immediate?: boolean },
): Promise<Id<'sessions'> | null> {
  const row = await ctx.runMutation(internal.sessions._claimSessionFiles, {
    operationId: args.operationId,
    immediate: args.immediate ?? false,
  })
  if (!row) return null

  const { postSidecar } = await import('../../model/sidecar')
  try {
    if (row.kind === 'delete') {
      await postSidecar('/session-files/delete', { sessionId: row.sessionId })
    } else {
      await postSidecar('/session-files/duplicate', {
        sourceId: row.sourceId,
        targetId: row.sessionId,
        sessionIds: row.sessionIds,
        token: row.token,
      })
    }
  } catch (cause) {
    if (row.kind === 'duplicate') {
      await finish(ctx, row._id, row.attempt, false)
      if (args.immediate) throw cause
    }
    return null
  }

  return (await finish(ctx, row._id, row.attempt, true)) ? row.sessionId : null
}

function finish(
  ctx: ActionCtx,
  operationId: Id<'sessionFileOperations'>,
  attempt: number,
  success: boolean,
): Promise<boolean> {
  return ctx.runMutation(internal.sessions._finishSessionFiles, {
    operationId,
    attempt,
    success,
  })
}
