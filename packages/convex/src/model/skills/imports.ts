import { errorMessage } from '@sb/core/utils/errors'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { FinishSkillImportArgs, PrepareSkillImportArgs } from '../../types'

async function runningImport(
  ctx: MutationCtx,
  operationId: Id<'agentFileOperations'>,
  cursor: number,
) {
  const op = await ctx.db.get(operationId)
  if (
    !op ||
    op.kind !== 'install' ||
    op.status !== 'running' ||
    op.importCursor !== cursor
  ) {
    error('Skill import is no longer running', 409)
  }
  return op
}

/** Reserves names atomically and leaves existing clean bundles untouched. */
export async function prepare(ctx: MutationCtx, args: PrepareSkillImportArgs) {
  const op = await runningImport(ctx, args.operationId, args.cursor)

  const existing = await ctx.db
    .query('skills')
    .withIndex('by_ownerId_name', (q) =>
      q.eq('ownerId', op.ownerId).eq('name', args.metadata.name),
    )
    .first()
  if (existing?.status === 'ready') return null

  const running =
    existing &&
    (existing.importOperationId !== op._id ||
      (existing.operationId && existing.operationId !== op._id))
  if (running)
    error('A library operation is already running for this skill', 409)

  const fields = {
    ...args.metadata,
    status: 'installing' as const,
    operationId: op._id,
    importOperationId: op._id,
  }
  const skillId =
    existing?._id ??
    (await ctx.db.insert('skills', { ...fields, ownerId: op.ownerId }))
  if (existing) await ctx.db.patch(skillId, fields)
  await ctx.db.patch(op._id, { skillId, updatedAt: Date.now() })

  return skillId
}

/** Commits one copied bundle and advances its durable discovery cursor in the same transaction. */
export async function finish(ctx: MutationCtx, args: FinishSkillImportArgs) {
  const op = await runningImport(ctx, args.operationId, args.cursor)
  if (args.nextCursor <= args.cursor)
    error('Invalid skill discovery cursor', 400)

  if (args.skillId) {
    const skill = await ctx.db.get(args.skillId)
    if (op.skillId !== args.skillId || skill?.operationId !== op._id)
      error('Skill import reservation expired', 409)
    await ctx.db.patch(args.skillId, {
      status: args.outcome === 'installed' ? 'ready' : 'failed',
      operationId: undefined,
    })
  }

  const summary = op.importSummary ?? { installed: 0, skipped: 0, failed: 0 }

  const importSummary = {
    ...summary,
    [args.outcome]: summary[args.outcome] + 1,
  }
  const importError =
    op.importError ??
    (args.message
      ? (errorMessage(args.message) ?? 'Skill import failed').slice(0, 300)
      : undefined)

  await ctx.db.patch(op._id, {
    skillId: undefined,
    importCursor: args.nextCursor,
    importSummary,
    importError,
    updatedAt: Date.now(),
  })
}

/** Continues another bounded page in a new action. */
export async function continueImport(
  ctx: MutationCtx,
  args: { operationId: Id<'agentFileOperations'>; cursor: number },
) {
  const op = await runningImport(ctx, args.operationId, args.cursor)
  await ctx.db.patch(op._id, { status: 'queued', updatedAt: Date.now() })
  await ctx.scheduler.runAfter(0, internal.actions.skills._run, { operationId: op._id }) // prettier-ignore
  await ctx.scheduler.runAfter(10 * 60_000, internal.skills._watchdog, { operationId: op._id }) // prettier-ignore
}
