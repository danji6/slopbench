import { errorMessage } from '@sb/core/utils/errors'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { CompleteAgentFileArgs } from '../../types'
import { assertHomeDestination } from './destinations'

/** Commits metadata only after idempotent sidecar work has completed. */
export async function complete(ctx: MutationCtx, args: CompleteAgentFileArgs) {
  const op = await ctx.db.get(args.operationId)
  if (!op || op.status === 'done') return

  const expired =
    op.agentId && (await ctx.db.get(op.agentId))?.fileOperationId !== op._id
  if (expired) error('Personal folder operation expired', 409)

  await commitMetadata(ctx, op, args)
  if (op.kind === 'home') {
    await ctx.db.patch(op._id, {
      finishingHome: true,
      previousHomePath: args.previousPath,
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.skills._invalidateHomeCaches, {
      operationId: op._id,
      cursor: null,
      previousPath: args.previousPath,
    })
    return
  }
  await release(ctx, op._id)
  await ctx.db.patch(op._id, {
    status: op.importSummary?.failed ? 'failed' : 'done',
    updatedAt: Date.now(),
    error: op.importSummary?.failed
      ? (op.importError ?? 'Some skills could not be installed')
      : undefined,
  })
}

async function commitMetadata(
  ctx: MutationCtx,
  op: Doc<'agentFileOperations'>,
  args: CompleteAgentFileArgs,
) {
  switch (op.kind) {
    case 'install':
      if (op.importCursor !== undefined) return
      return commitInstalledSkill(ctx, op, args)
    case 'assign':
      return commitAssignment(ctx, op)
    case 'delete-assigned':
      if (op.assignmentId) await ctx.db.delete(op.assignmentId)
      return
    case 'delete-library':
      if (op.skillId) await ctx.db.delete(op.skillId)
      return
    case 'home':
    case 'ensure':
      return commitHome(ctx, op, args)
    case 'duplicate':
      if (op.duplicateId)
        await ctx.db.patch(op.duplicateId, { resolvedHomePath: args.path })
      return
  }
}

async function commitInstalledSkill(
  ctx: MutationCtx,
  op: Doc<'agentFileOperations'>,
  args: CompleteAgentFileArgs,
) {
  if (!op.skillId || !args.metadata)
    error('Missing installed skill metadata', 409)
  const duplicate = await ctx.db
    .query('skills')
    .withIndex('by_ownerId_name', (q) =>
      q.eq('ownerId', op.ownerId).eq('name', args.metadata!.name),
    )
    .first()
  if (duplicate && duplicate._id !== op.skillId)
    error('A skill with this name is already installed', 409)
  await ctx.db.patch(op.skillId, {
    ...args.metadata,
    status: 'ready',
    operationId: undefined,
  })
}

async function commitAssignment(
  ctx: MutationCtx,
  op: Doc<'agentFileOperations'>,
) {
  const skill = op.skillId ? await ctx.db.get(op.skillId) : null
  if (!skill || !op.agentId) error('Skill no longer exists', 409)
  const existing = await ctx.db
    .query('agentSkills')
    .withIndex('by_agentId_skillId', (q) =>
      q.eq('agentId', op.agentId!).eq('skillId', skill._id),
    )
    .first()
  if (!existing) {
    await ctx.db.insert('agentSkills', {
      ownerId: op.ownerId,
      agentId: op.agentId,
      skillId: skill._id,
      name: skill.name,
      description: skill.description,
    })
  }
}

async function commitHome(
  ctx: MutationCtx,
  op: Doc<'agentFileOperations'>,
  args: CompleteAgentFileArgs,
) {
  if (!op.agentId) return
  if (args.path) await assertHomeDestination(ctx, op.agentId, args.path)
  const agent = await ctx.db.get(op.agentId)
  await ctx.db.patch(op.agentId, {
    homePath:
      op.kind === 'home'
        ? op.destination
          ? args.path
          : undefined
        : agent?.homePath,
    resolvedHomePath: args.path,
  })
}

/** Releases database leases; sidecar locks still guard an unfinished HTTP operation. */
export async function fail(
  ctx: MutationCtx,
  args: { operationId: Id<'agentFileOperations'>; message: string },
) {
  const op = await ctx.db.get(args.operationId)
  if (!op || op.status === 'done') return
  if (op.kind === 'install' && op.skillId && (await ctx.db.get(op.skillId))) {
    await ctx.db.patch(op.skillId, { status: 'failed' })
  }
  await release(ctx, op._id)
  await ctx.db.patch(op._id, {
    status: 'failed',
    error: (errorMessage(args.message) ?? 'Filesystem operation failed').slice(
      0,
      500,
    ),
    updatedAt: Date.now(),
  })
}

export async function release(
  ctx: MutationCtx,
  operationId: Id<'agentFileOperations'>,
) {
  const op = await ctx.db.get(operationId)
  if (!op) return
  for (const id of [op.agentId, op.duplicateId]) {
    if (!id) continue
    const agent = await ctx.db.get(id)
    if (!agent || agent.fileOperationId !== operationId) continue
    await ctx.db.patch(id, {
      fileOperationId: undefined,
      pendingHomePath: undefined,
      homeRevision: (agent.homeRevision ?? 0) + 1,
    })
  }
  if (op.skillId) {
    const skill = await ctx.db.get(op.skillId)
    if (skill?.operationId === operationId)
      await ctx.db.patch(skill._id, { operationId: undefined })
  }
}
