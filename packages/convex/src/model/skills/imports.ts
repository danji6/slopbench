import { errorMessage } from '@sb/core/utils/errors'

import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type {
  ContinueSkillImportArgs,
  FinishSkillImportArgs,
  PrepareSkillImportArgs,
} from '../../types'
import { isExecutingOperation, scheduleOperation } from './lifecycle'

type ImportOperation = Extract<Doc<'agentFileOperations'>, { kind: 'install' }>
type ImportPage = Pick<
  PrepareSkillImportArgs,
  'operationId' | 'cursor' | 'attempt'
>

async function runningImport(
  ctx: MutationCtx,
  { operationId, cursor, attempt }: ImportPage,
) {
  const op = await ctx.db.get(operationId)
  const invalid =
    !isExecutingOperation(op, attempt) ||
    op.kind !== 'install' ||
    op.progress.cursor !== cursor
  if (invalid) {
    error('Skill import is no longer running', 409)
  }
  return op
}

/** Reserves names atomically and leaves existing clean bundles untouched. */
export async function prepare(ctx: MutationCtx, args: PrepareSkillImportArgs) {
  const op = await runningImport(ctx, args)

  if (op.progress.skillId)
    return existingImportSkill(ctx, op, args.metadata.name)
  return reserveImportSkill(ctx, op, args.metadata)
}

async function existingImportSkill(
  ctx: MutationCtx,
  op: ImportOperation,
  name: string,
) {
  const id = op.progress.skillId
  if (!id) error('Skill import reservation expired', 409)
  const skill = await ctx.db.get(id)
  if (!skill || skill.operationId !== op._id || skill.name !== name)
    error('Skill import reservation expired', 409)
  return id
}

async function reserveImportSkill(
  ctx: MutationCtx,
  op: ImportOperation,
  metadata: PrepareSkillImportArgs['metadata'],
) {
  const existing = await ctx.db
    .query('skills')
    .withIndex('by_ownerId_name', (q) =>
      q.eq('ownerId', op.ownerId).eq('name', metadata.name),
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
    ...metadata,
    status: 'installing' as const,
    operationId: op._id,
    importOperationId: op._id,
  }
  const skillId =
    existing?._id ??
    (await ctx.db.insert('skills', { ...fields, ownerId: op.ownerId }))
  if (existing) await ctx.db.patch(skillId, fields)
  await ctx.db.patch(op._id, {
    progress: { ...op.progress, skillId },
    updatedAt: Date.now(),
  })

  return skillId
}

/** Commits one copied bundle and advances its durable discovery cursor in the same transaction. */
export async function finish(ctx: MutationCtx, args: FinishSkillImportArgs) {
  const op = await runningImport(ctx, args)
  if (args.nextCursor <= args.cursor)
    error('Invalid skill discovery cursor', 400)

  await commitImportSkill(ctx, op, args)

  const summary = op.progress.summary

  const importSummary = {
    ...summary,
    [args.outcome]: summary[args.outcome] + 1,
  }
  const importError =
    op.progress.error ??
    (args.message
      ? (errorMessage(args.message) ?? 'Skill import failed').slice(0, 300)
      : undefined)

  await ctx.db.patch(op._id, {
    progress: {
      cursor: args.nextCursor,
      summary: importSummary,
      error: importError,
    },
    updatedAt: Date.now(),
  })
}

async function commitImportSkill(
  ctx: MutationCtx,
  op: ImportOperation,
  args: FinishSkillImportArgs,
) {
  if (args.skillId !== op.progress.skillId)
    error('Skill import reservation expired', 409)
  if (args.outcome === 'installed' && !args.skillId)
    error('Installed skill was not reserved', 409)
  if (!args.skillId) return
  const skill = await ctx.db.get(args.skillId)
  if (skill?.operationId !== op._id)
    error('Skill import reservation expired', 409)
  await ctx.db.patch(args.skillId, {
    status: args.outcome === 'installed' ? 'ready' : 'failed',
    operationId: undefined,
  })
}

/** Continues another bounded page in a new action. */
export async function continueImport(
  ctx: MutationCtx,
  args: ContinueSkillImportArgs,
) {
  const op = await runningImport(ctx, args)
  const attempt = op.attempt + 1
  await ctx.db.patch(op._id, {
    state: { phase: 'queued' },
    attempt,
    updatedAt: Date.now(),
  })
  await scheduleOperation(ctx, { operationId: op._id, attempt })
}
