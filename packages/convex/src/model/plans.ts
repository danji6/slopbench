import { applyEdits } from '@sb/core/workspace/edit'

import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import type { PlanStatus } from '../types'
import { getMember, requireMember } from './session/memberships'

export type PlanEdit = { oldText: string; newText: string }

export type PlanLinkPart = {
  type: 'plan-link'
  snapshot: { content: string; status: PlanStatus }
}

/**
 * A snapshot of the plan, injected after certain events (compaction summary,
 * dirty-plan send) and resolved to a <plan> block at history build time.
 */
export function createPlanLinkPart(plan: {
  content: string
  status: PlanStatus
}): PlanLinkPart {
  return {
    type: 'plan-link',
    snapshot: { content: plan.content, status: plan.status },
  }
}

export async function getBySession(ctx: QueryCtx, sessionId: Id<'sessions'>) {
  return ctx.db
    .query('plans')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .unique()
}

/** Creates or fully replaces the session's plan, preserving its status. */
export async function upsert(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  content: string,
  patch?: { status?: PlanStatus; dirty?: boolean },
) {
  const existing = await getBySession(ctx, sessionId)
  const updatedAt = Date.now()

  if (existing) {
    await ctx.db.patch(existing._id, { content, updatedAt, ...patch })
    return existing._id
  }

  return ctx.db.insert('plans', {
    sessionId,
    content,
    status: patch?.status ?? 'draft',
    dirty: patch?.dirty,
    updatedAt,
  })
}

export async function setStatus(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  status: PlanStatus,
) {
  const existing = await getBySession(ctx, sessionId)
  if (existing && existing.status !== status) {
    await ctx.db.patch(existing._id, { status })
  }
}

/** Demotes the plan to a revisable draft that needs approval again. */
export async function demoteToDraft(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  await setStatus(ctx, sessionId, 'draft')
}

export async function remove(ctx: MutationCtx, sessionId: Id<'sessions'>) {
  const existing = await getBySession(ctx, sessionId)
  if (existing) await ctx.db.delete(existing._id)
}

export async function get(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  if (!(await getMember(ctx, sessionId, ctx.userId))) return null
  return getBySession(ctx, sessionId)
}

/** Used for user manual edits. Marks the plan as dirty for re-injection. */
export async function update(
  ctx: AuthMutationCtx,
  { sessionId, content }: { sessionId: Id<'sessions'>; content: string },
) {
  await requireMember(ctx, sessionId, ctx.userId)
  await upsert(ctx, sessionId, content, { dirty: true })
}

export async function removePlan(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  await requireMember(ctx, sessionId, ctx.userId)
  await remove(ctx, sessionId)
}

/**
 * Used for a full plan rewrite by the agent. Clears the dirty flag since
 * the tool's own output already carries the full new content, therefore
 * re-injection isn't needed.
 */
export async function _write(
  ctx: MutationCtx,
  { sessionId, content }: { sessionId: Id<'sessions'>; content: string },
) {
  await upsert(ctx, sessionId, content, { dirty: false })
}

export type PlanEditResult =
  | { ok: true; content: string }
  | { ok: false; error: string; content: string | null }

/**
 * Scoped edits by the agent, applied against the current row. Preserves
 * the dirty flag. Returns the current content on a failed match.
 */
export async function _edit(
  ctx: MutationCtx,
  { sessionId, edits }: { sessionId: Id<'sessions'>; edits: PlanEdit[] },
): Promise<PlanEditResult> {
  const existing = await getBySession(ctx, sessionId)
  if (!existing) {
    return {
      ok: false,
      error: 'No plan exists yet. Create one with write_plan first.',
      content: null,
    }
  }

  try {
    const content = applyEdits(existing.content, edits, 'the plan')
    await ctx.db.patch(existing._id, { content, updatedAt: Date.now() })
    return { ok: true, content }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      content: existing.content,
    }
  }
}
