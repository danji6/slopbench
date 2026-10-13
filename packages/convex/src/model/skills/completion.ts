import { errorMessage } from '@sb/core/utils/errors'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { CompleteAgentFileArgs } from '../../types'
import { assertHomeDestination } from './destinations'
import { bindHome, ensureHome, releaseHome } from './homes'
import { detachHome } from './removal'

/** Commits metadata only after idempotent sidecar work has completed. */
export async function complete(ctx: MutationCtx, args: CompleteAgentFileArgs) {
  const op = await ctx.db.get(args.operationId)

  const invalid =
    !op ||
    op.status === 'done' ||
    op.status === 'failed' ||
    (args.attempt !== undefined && op.attempt !== args.attempt)
  if (invalid) return

  const expired =
    op.agentId && (await ctx.db.get(op.agentId))?.fileOperationId !== op._id
  if (expired) error('Personal folder operation expired', 409)

  await commitMetadata(ctx, op, args)
  if (op.kind === 'home' || op.kind === 'detach') {
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
    case 'detach':
      return detachHome(ctx, op)
    case 'delete-home':
      if (op.homeId)
        await ctx.scheduler.runAfter(0, internal.skills._cleanupHomeRecords, {
          homeId: op.homeId,
        })
      return
    case 'install':
      if (op.importCursor !== undefined) return
      return commitInstalledSkill(ctx, op, args)
    case 'assign':
      await commitAssignment(ctx, op)
      if (args.path) await commitHome(ctx, op, args)
      return
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
        await commitHome(
          ctx,
          { ...op, agentId: op.duplicateId, destinationHomeId: undefined },
          args,
        )
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
  const existing = op.homeId
    ? await ctx.db
        .query('agentSkills')
        .withIndex('by_homeId_skillId', (q) =>
          q.eq('homeId', op.homeId).eq('skillId', skill._id),
        )
        .first()
    : await ctx.db
        .query('agentSkills')
        .withIndex('by_agentId_skillId', (q) =>
          q.eq('agentId', op.agentId!).eq('skillId', skill._id),
        )
        .first()
  if (!existing) {
    await ctx.db.insert('agentSkills', {
      ownerId: op.ownerId,
      agentId: op.agentId,
      homeId: op.homeId,
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
  if (!agent) return
  const home = op.destinationHomeId
    ? await ctx.db.get(op.destinationHomeId)
    : await ensureHome(ctx, agent)
  if (!home) error('Personal folder no longer exists', 409)
  await ctx.db.patch(home._id, { path: args.path })
  await bindHome(ctx, agent._id, { ...home, path: args.path })
}

/** Releases database leases; sidecar locks still guard an unfinished HTTP operation. */
export async function fail(
  ctx: MutationCtx,
  args: {
    operationId: Id<'agentFileOperations'>
    message: string
    attempt?: number
  },
) {
  const op = await ctx.db.get(args.operationId)

  const invalid =
    !op ||
    op.status === 'done' ||
    (args.attempt !== undefined && op.attempt !== args.attempt)
  if (invalid) return

  if (op.kind === 'install' && op.skillId && (await ctx.db.get(op.skillId)))
    await ctx.db.patch(op.skillId, { status: 'failed' })
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
  for (const homeId of new Set([op.homeId, op.destinationHomeId])) {
    if (homeId) await releaseHome(ctx, homeId, operationId)
  }
  for (const id of [op.agentId, op.duplicateId]) {
    if (!id) continue
    const agent = await ctx.db.get(id)
    if (!agent || agent.fileOperationId !== operationId) continue
    if (agent.homeId) await releaseHome(ctx, agent.homeId, operationId)
    await ctx.db.patch(id, {
      fileOperationId: undefined,
      pendingHomePath: undefined,
      homeRevision: agent.homeId
        ? ((await ctx.db.get(agent.homeId))?.revision ?? agent.homeRevision)
        : (agent.homeRevision ?? 0) + 1,
    })
  }
  if (op.skillId) {
    const skill = await ctx.db.get(op.skillId)
    if (skill?.operationId === operationId)
      await ctx.db.patch(skill._id, { operationId: undefined })
  }
}
