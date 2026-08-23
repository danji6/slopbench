import { MAX_APPROVAL_PATHS, MAX_APPROVAL_PATTERNS } from '@sb/core/limits'

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

  await ctx.db.insert('sessionState', { sessionId, ...patch, updatedAt })
}

/** Copies a parent's approval settings onto a session it spawns. */
export async function cloneApprovals(
  ctx: MutationCtx,
  { from, to }: { from: Id<'sessions'>; to: Id<'sessions'> },
): Promise<void> {
  const approvals = (await getState(ctx, from))?.toolApprovals
  if (!approvals) return

  await patchState(ctx, to, {
    toolApprovals: {
      mode: approvals.mode,
      tools: approvals.tools?.slice(),
      shell: approvals.shell?.slice(),
      paths: approvals.paths?.slice(),
    },
  })
}

export async function setApprovalMode(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  mode: ApprovalMode,
): Promise<void> {
  const approvals = await getApprovals(ctx, sessionId)
  const { mode: _current, ...remembered } = approvals

  await patchState(ctx, sessionId, {
    toolApprovals:
      mode === 'unrestricted' ? { ...remembered, mode } : remembered,
  })
}

export async function getApprovals(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
): Promise<NonNullable<SessionState['toolApprovals']>> {
  return (await getState(ctx, sessionId))?.toolApprovals ?? {}
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
  const approvals = await getApprovals(ctx, sessionId)

  await patchState(ctx, sessionId, {
    toolApprovals: { ...approvals, [list]: values.slice(0, approvalCap(list)) },
  })
}
