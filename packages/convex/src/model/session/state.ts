import { MAX_APPROVAL_PATHS, MAX_APPROVAL_PATTERNS } from '@sb/core/limits'
import { capApprovalPaths } from '@sb/core/workspace/path-policy'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import type { ApprovalMode } from '../../types'
import { assertEnvironmentCap } from '../caps'

export type SessionState = Doc<'sessionState'>

export type SessionStatePatch = Partial<
  Omit<SessionState, '_id' | '_creationTime' | 'sessionId' | 'updatedAt'>
>

/** A session's hot state. Absent until something writes to it. */
export async function getState(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
): Promise<SessionState | null> {
  return ctx.db
    .query('sessionState')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .unique()
}

/** Reads the successful provider-step count. */
export async function getStepCount(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
): Promise<number> {
  return (await getState(ctx, sessionId))?.stepCount ?? 0
}

/** Advances the step reminder count after a successful invoke step. */
export async function advanceStepCount(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
): Promise<number> {
  const next = (await getStepCount(ctx, sessionId)) + 1
  await patchState(ctx, sessionId, { stepCount: next })
  return next
}

/** Patches the state row, creating it on first write. */
export async function patchState(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  patch: SessionStatePatch,
): Promise<void> {
  if (patch.environment) assertEnvironmentCap(patch.environment)
  const existing = await getState(ctx, sessionId)
  const updatedAt = Date.now()

  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt })
    return
  }

  await ctx.db.insert('sessionState', {
    sessionId,
    stepCount: 0,
    ...patch,
    updatedAt,
  })
}

/** Resolves the main session that owns approvals for the whole task. */
async function getApprovalSessionId(ctx: QueryCtx, sessionId: Id<'sessions'>) {
  let session = await ctx.db.get(sessionId)
  while (session?.parent) {
    sessionId = session.parent.sessionId
    session = await ctx.db.get(sessionId)
  }
  return sessionId
}

export async function setApprovalMode(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  mode: ApprovalMode,
): Promise<void> {
  sessionId = await getApprovalSessionId(ctx, sessionId)
  const approvals = await getApprovals(ctx, sessionId)
  const { mode: _current, ...remembered } = approvals

  await patchState(ctx, sessionId, {
    toolApprovals:
      mode === 'unrestricted' ? { ...remembered, mode } : remembered,
  })
}

/** Reads the shared approval policy, ignoring legacy child snapshots. */
export async function getApprovals(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
): Promise<NonNullable<SessionState['toolApprovals']>> {
  const ownerId = await getApprovalSessionId(ctx, sessionId)
  return (await getState(ctx, ownerId))?.toolApprovals ?? {}
}

type ApprovalList = 'tools' | 'shell' | 'paths'

const approvalCap = (list: ApprovalList) =>
  list === 'paths' ? MAX_APPROVAL_PATHS : MAX_APPROVAL_PATTERNS

/**
 * Appends to a remembered approval list, dropping whatever passes the cap.
 * The drop is deliberately silent since the user already approved the tool at
 * this stage.
 */
export async function appendApprovals(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  list: ApprovalList,
  additions: string[],
): Promise<void> {
  const existing = (await getApprovals(ctx, sessionId))[list] ?? []

  // Only cap additions
  if (existing.length >= approvalCap(list)) return

  await setApprovals(ctx, sessionId, list, [...existing, ...additions])
}

/**
 * Replaces a remembered approval list. For callers that rewrite entries rather
 * than only adding to them.
 */
export async function setApprovals(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  list: ApprovalList,
  values: string[],
): Promise<void> {
  sessionId = await getApprovalSessionId(ctx, sessionId)
  const approvals = await getApprovals(ctx, sessionId)

  await patchState(ctx, sessionId, {
    toolApprovals: {
      ...approvals,
      [list]:
        list === 'paths'
          ? capApprovalPaths(values)
          : values.slice(0, approvalCap(list)),
    },
  })
}
