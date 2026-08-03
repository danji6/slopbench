import { MAX_APPROVAL_PATHS, MAX_APPROVAL_PATTERNS } from '@sb/core/limits'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
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

/** Copies a parent's approvals onto a session it spawns. */
export async function cloneApprovals(
  ctx: MutationCtx,
  { from, to }: { from: Id<'sessions'>; to: Id<'sessions'> },
): Promise<void> {
  const approvals = (await getState(ctx, from))?.toolApprovals
  if (!approvals) return

  await patchState(ctx, to, {
    toolApprovals: {
      tools: approvals.tools?.slice(),
      shell: approvals.shell?.slice(),
      paths: approvals.paths?.slice(),
    },
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
  const approvals = await getApprovals(ctx, sessionId)
  const existing = approvals[list] ?? []

  // Only cap additions
  const room = approvalCap(list) - existing.length
  if (room <= 0) return

  await patchState(ctx, sessionId, {
    toolApprovals: {
      ...approvals,
      [list]: [...existing, ...additions.slice(0, room)],
    },
  })
}
