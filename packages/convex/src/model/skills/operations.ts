import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { FileOperationArgs } from '../../types'
import {
  assertAgentIdle,
  requireAdmin,
  requireOwnedAgent,
  requireOwnedSkill,
} from './access'
import { ensureHome } from './homes'
import { validateOperationArgs } from './operationArgs'
import { assertCanRemoveHome, assertRemovableHome } from './removal'

type PreparedSkill = { skillId?: Id<'skills'>; uploadTicket?: string }
type OperationClaim = Pick<
  Doc<'agentFileOperations'>,
  'agentId' | 'duplicateId' | 'skillId'
> & { id: Id<'agentFileOperations'> }
type SkillOperation = Pick<Doc<'agentFileOperations'>, 'kind' | 'agentId'>
type AssignmentArgs = Extract<FileOperationArgs, { kind: 'delete-assigned' }>
type InstallArgs = Extract<FileOperationArgs, { kind: 'install' }>

/** Reserves filesystem work. Queries expose progress while the sidecar performs it. */
export async function start(ctx: AuthMutationCtx, args: FileOperationArgs) {
  requireAdmin(ctx)
  validateOperationArgs(args)

  const agentId = 'agentId' in args ? args.agentId : undefined
  const duplicateId = args.kind === 'duplicate' ? args.duplicateId : undefined
  for (const id of [agentId, duplicateId]) {
    if (id) await ensureHome(ctx, await requireOwnedAgent(ctx, id, ctx.userId))
  }
  await validateTargets(ctx, args)

  if (args.kind === 'detach' && args.removeFolder) {
    const agent = (await ctx.db.get(args.agentId))!
    await assertCanRemoveHome(
      ctx,
      (await ctx.db.get(agent.homeId!))!,
      agent._id,
    )
  }

  const prepared = await prepareSkill(ctx, args)

  const id = await ctx.db.insert('agentFileOperations', {
    ...args,
    ...prepared,
    ...(args.kind === 'install'
      ? {
          importCursor: 0,
          importSummary: { installed: 0, skipped: 0, failed: 0 },
        }
      : {}),
    ownerId: ctx.userId,
    homeId: agentId ? (await ctx.db.get(agentId))?.homeId : undefined,
    destinationHomeId: duplicateId
      ? (await ctx.db.get(duplicateId))?.homeId
      : undefined,
    status: 'queued',
    updatedAt: Date.now(),
  })

  await claimOperation(ctx, { agentId, duplicateId, ...prepared, id })
  await scheduleOperation(ctx, id)

  return id
}

async function validateTargets(ctx: AuthMutationCtx, args: FileOperationArgs) {
  if ('agentId' in args) await assertAgentIdle(ctx, args.agentId, ctx.userId)
  if (args.kind === 'duplicate')
    await requireOwnedAgent(ctx, args.duplicateId, ctx.userId)
}

async function prepareSkill(
  ctx: AuthMutationCtx,
  args: FileOperationArgs,
): Promise<PreparedSkill> {
  switch (args.kind) {
    case 'install':
      return prepareInstall(ctx, args)
    case 'assign':
    case 'delete-library':
      await validateSkill(ctx, args, args.skillId)
      return { skillId: args.skillId }
    case 'delete-assigned': {
      const skillId = await assignmentSkillId(ctx, args)
      await validateSkill(ctx, args, skillId)
      return { skillId }
    }
    default:
      return {}
  }
}

async function assignmentSkillId(ctx: AuthMutationCtx, args: AssignmentArgs) {
  const assignment = await ctx.db.get(args.assignmentId)
  if (
    !assignment ||
    assignment.ownerId !== ctx.userId ||
    assignment.homeId !== (await ctx.db.get(args.agentId))?.homeId
  ) {
    error('Assignment not found', 404)
  }
  return assignment.skillId
}

async function prepareInstall(
  ctx: AuthMutationCtx,
  args: InstallArgs,
): Promise<PreparedSkill> {
  if ('source' in args) return {}
  const upload = await requireStagedUpload(ctx, args.storageId)
  return { uploadTicket: upload.ticket }
}

async function claimOperation(ctx: AuthMutationCtx, claim: OperationClaim) {
  for (const agentId of [claim.agentId, claim.duplicateId]) {
    if (!agentId) continue
    const agent = await ctx.db.get(agentId)
    if (agent?.homeId)
      await ctx.db.patch(agent.homeId, { operationId: claim.id })
    await ctx.db.patch(agentId, { fileOperationId: claim.id })
  }
  if (claim.skillId)
    await ctx.db.patch(claim.skillId, { operationId: claim.id })
}

async function scheduleOperation(
  ctx: AuthMutationCtx,
  operationId: Id<'agentFileOperations'>,
) {
  await ctx.scheduler.runAfter(0, internal.actions.skills._run, { operationId })
  await ctx.scheduler.runAfter(10 * 60_000, internal.skills._watchdog, { operationId }) // prettier-ignore
}

async function validateSkill(
  ctx: AuthMutationCtx,
  args: SkillOperation,
  skillId: Id<'skills'>,
) {
  const skill = await requireOwnedSkill(ctx, skillId, ctx.userId)
  if (
    skill.operationId ||
    (skill.status !== 'ready' && args.kind !== 'delete-library')
  ) {
    error('Wait for the library operation to finish', 409)
  }

  if (args.kind === 'delete-library') {
    const assigned = await ctx.db
      .query('agentSkills')
      .withIndex('by_skillId', (q) => q.eq('skillId', skillId))
      .first()
    if (assigned) {
      error(
        'Remove this skill from its agents before deleting the library bundle',
        409,
      )
    }
  }

  if (args.kind === 'assign') {
    const agent = await ctx.db.get(args.agentId!)
    const assignment = await ctx.db
      .query('agentSkills')
      .withIndex('by_homeId_name', (q) =>
        q.eq('homeId', agent!.homeId!).eq('name', skill.name),
      )
      .first()
    if (assignment) error('This skill is already assigned', 409)
  }
}

/** Upload identities are owned independently of arbitrary client-supplied storage ids. */
async function requireStagedUpload(
  ctx: AuthMutationCtx,
  storageId: Id<'_storage'>,
) {
  const upload = await ctx.db
    .query('skillUploads')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .unique()
  if (!upload || upload.ownerId !== ctx.userId)
    error('Skill upload not found', 404)
  return upload
}

/** Reclaims a failed operation after rechecking its current targets and ownership. */
export async function retry(
  ctx: AuthMutationCtx,
  args: { operationId: Id<'agentFileOperations'> },
) {
  requireAdmin(ctx)
  const operation = await requireFailedOperation(ctx, args.operationId)
  if (await alreadyDeleted(ctx, operation)) {
    await ctx.db.patch(operation._id, {
      status: 'done',
      error: undefined,
      updatedAt: Date.now(),
    })
    return
  }
  if (operation.kind === 'delete-home' && operation.homeId) {
    await assertRemovableHome(ctx, operation.homeId, operation._id)
    await ctx.db.patch(operation.homeId, { operationId: operation._id })
  }
  await validateRetryTargets(ctx, operation)
  await claimOperation(ctx, { ...operation, id: operation._id })
  await ctx.db.patch(operation._id, {
    status: 'queued',
    error: undefined,
    updatedAt: Date.now(),
    ...(operation.kind === 'install'
      ? {
          importCursor: 0,
          importSummary: { installed: 0, skipped: 0, failed: 0 },
          importError: undefined,
        }
      : {}),
  })
  await scheduleOperation(ctx, operation._id)
}

async function requireFailedOperation(
  ctx: AuthMutationCtx,
  id: Id<'agentFileOperations'>,
) {
  const operation = await ctx.db.get(id)
  if (
    !operation ||
    operation.ownerId !== ctx.userId ||
    operation.status !== 'failed'
  ) {
    error('Operation not found', 404)
  }
  return operation
}

async function alreadyDeleted(
  ctx: AuthMutationCtx,
  operation: Doc<'agentFileOperations'>,
) {
  if (operation.kind === 'delete-assigned' && operation.assignmentId)
    return !(await ctx.db.get(operation.assignmentId))
  if (operation.kind === 'delete-library' && operation.skillId)
    return !(await ctx.db.get(operation.skillId))
  return false
}

async function validateRetryTargets(
  ctx: AuthMutationCtx,
  operation: Doc<'agentFileOperations'>,
) {
  if (operation.agentId && operation.homeId) {
    const agent = await ctx.db.get(operation.agentId)
    if (agent?.homeId !== operation.homeId)
      error('The agent changed folders. Start a new operation instead.', 409)
  }
  if (operation.kind === 'detach' && operation.removeFolder && operation.homeId)
    await assertCanRemoveHome(
      ctx,
      (await ctx.db.get(operation.homeId))!,
      operation.agentId!,
    )
  if (operation.skillId && operation.kind !== 'install')
    await validateSkill(ctx, operation, operation.skillId)
  for (const id of [operation.agentId, operation.duplicateId]) {
    if (id) await assertAgentIdle(ctx, id, ctx.userId)
  }
  if (operation.skillId) {
    const skill = await requireOwnedSkill(ctx, operation.skillId, ctx.userId)
    if (skill.operationId) error('Library operation in progress', 409)
  }
}

export type OperationContext = {
  operation: Doc<'agentFileOperations'>
  agent: Doc<'agents'> | null
  skill: Doc<'skills'> | null
  home?: Doc<'agentHomes'> | null
  destinationHome?: Doc<'agentHomes'> | null
}

/** Claims a queued operation once, while checking its current filesystem leases. */
export async function running(
  ctx: MutationCtx,
  args: { operationId: Id<'agentFileOperations'> },
) {
  const operation = await ctx.db.get(args.operationId)
  if (!operation || operation.status !== 'queued') return false
  if (operation.kind === 'delete-home' && operation.homeId)
    await assertRemovableHome(ctx, operation.homeId, operation._id)

  for (const id of [operation.agentId, operation.duplicateId]) {
    if (id && (await ctx.db.get(id))?.fileOperationId !== args.operationId)
      return false
  }

  if (
    operation.skillId &&
    (await ctx.db.get(operation.skillId))?.operationId !== args.operationId
  ) {
    return false
  }

  const attempt = (operation.attempt ?? 0) + 1
  await ctx.db.patch(args.operationId, {
    attempt,
    status: 'running',
    updatedAt: Date.now(),
  })
  return attempt
}
