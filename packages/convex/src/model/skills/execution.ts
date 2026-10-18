import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { OperationAttemptArgs } from '../../types'
import { requireOwnedAgent, requireOwnedSkill } from './access'
import { fail } from './completion'
import { deletionTargets } from './libraryDeletion'
import type { LibraryDeletionTarget } from './libraryDeletion'
import { holdsOperationReservations, matchesAttempt } from './lifecycle'
import { assertRemovableHome } from './removal'

type Operation = Doc<'agentFileOperations'>

type ExecutingOperation = Operation & { state: { phase: 'executing' } }

type Context<K extends Operation['kind'], Targets = object> = {
  [Kind in K]: {
    kind: Kind
    operation: Extract<ExecutingOperation, { kind: Kind }>
  } & Targets
}[K]

type AgentTarget = { agent: Doc<'agents'>; home: Doc<'agentHomes'> }

export type ExecutionContext =
  | Context<'ensure' | 'home' | 'detach', AgentTarget>
  | Context<
      'duplicate',
      AgentTarget & {
        duplicate: Doc<'agents'>
        destinationHome: Doc<'agentHomes'>
      }
    >
  | Context<'assign', AgentTarget & { skill: Doc<'skills'> }>
  | Context<
      'delete-assigned',
      AgentTarget & {
        assignment: Doc<'agentSkills'>
        skill: Doc<'skills'> | null
      }
    >
  | Context<
      'delete-library',
      { skill: Doc<'skills'>; targets: LibraryDeletionTarget[] }
    >
  | Context<'delete-home', { home: Doc<'agentHomes'> }>
  | Context<'install'>

/** Claims one queued attempt and resolves its resources in the same transaction. */
export async function claimExecution(
  ctx: MutationCtx,
  args: OperationAttemptArgs,
): Promise<ExecutionContext | null> {
  const op = await ctx.db.get(args.operationId)
  if (!matchesAttempt(op, args.attempt)) return null
  if (op.state.phase !== 'queued') return null

  try {
    if (!(await holdsOperationReservations(ctx, op)))
      error('Filesystem operation reservation expired', 409)
    const state = { phase: 'executing' as const }
    const data = await resolveExecution(ctx, { ...op, state })
    await ctx.db.patch(op._id, { state, updatedAt: Date.now() })
    return data
  } catch (cause) {
    // Commit the claim failure rather than roll it back by throwing.
    await fail(ctx, {
      ...args,
      message:
        cause instanceof Error
          ? cause.message
          : 'Filesystem resources are unavailable',
    })
    return null
  }
}

async function resolveAgent(
  ctx: MutationCtx,
  op: Extract<ExecutingOperation, { agentId: unknown }>,
) {
  const agent = await requireOwnedAgent(ctx, op.agentId, op.ownerId)
  const home = await ctx.db.get(op.homeId)
  const changed =
    !home || home.ownerId !== op.ownerId || agent.homeId !== home._id
  if (changed) error('Personal folder changed before execution', 409)
  return { agent, home }
}

async function resolveExecution(
  ctx: MutationCtx,
  op: ExecutingOperation,
): Promise<ExecutionContext> {
  switch (op.kind) {
    case 'install':
      return { kind: op.kind, operation: op }
    case 'delete-home': {
      const home = await assertRemovableHome(ctx, op.homeId, op._id)
      if (home.ownerId !== op.ownerId)
        error('Managed folder ownership changed', 409)
      return { kind: op.kind, operation: op, home }
    }
    case 'delete-library': {
      const skill = await requireOwnedSkill(ctx, op.skillId, op.ownerId)
      const targets = await deletionTargets(ctx, skill)
      if (targets.some(({ home }) => !op.homeIds?.includes(home._id)))
        error('Skill assignments changed before deletion', 409)
      return { kind: op.kind, operation: op, skill, targets }
    }
    case 'duplicate':
      return resolveDuplicate(ctx, op)
    case 'assign':
    case 'delete-assigned':
      return resolveSkillCommand(ctx, op)
    default:
      return resolveAgentCommand(ctx, op)
  }
}

async function resolveDuplicate(
  ctx: MutationCtx,
  op: Extract<ExecutingOperation, { kind: 'duplicate' }>,
): Promise<Extract<ExecutionContext, { kind: 'duplicate' }>> {
  const source = await resolveAgent(ctx, op)
  const duplicate = await requireOwnedAgent(ctx, op.duplicateId, op.ownerId)
  const destinationHome = await ctx.db.get(op.destinationHomeId)

  const changed =
    !destinationHome ||
    destinationHome.ownerId !== op.ownerId ||
    duplicate.homeId !== destinationHome._id
  if (changed) error('Duplicate folder changed before execution', 409)

  return { kind: op.kind, operation: op, ...source, duplicate, destinationHome }
}

async function resolveSkillCommand(
  ctx: MutationCtx,
  op: Extract<ExecutingOperation, { kind: 'assign' | 'delete-assigned' }>,
): Promise<Extract<ExecutionContext, { kind: 'assign' | 'delete-assigned' }>> {
  const target = await resolveAgent(ctx, op)
  if (op.kind === 'assign') {
    const skill = await requireOwnedSkill(ctx, op.skillId, op.ownerId)
    return { kind: op.kind, operation: op, ...target, skill }
  }
  const skill = op.skillId
    ? await requireOwnedSkill(ctx, op.skillId, op.ownerId)
    : null

  const assignment = await ctx.db.get(op.assignmentId)
  const changed =
    !assignment ||
    assignment.ownerId !== op.ownerId ||
    assignment.homeId !== op.homeId ||
    (!!op.skillId && assignment.skillId !== op.skillId)
  if (changed) error('Assignment changed before execution', 409)

  return { kind: op.kind, operation: op, ...target, skill, assignment }
}

async function resolveAgentCommand(
  ctx: MutationCtx,
  op: Extract<ExecutingOperation, { kind: 'home' | 'ensure' | 'detach' }>,
): Promise<Extract<ExecutionContext, { kind: 'home' | 'ensure' | 'detach' }>> {
  const target = await resolveAgent(ctx, op)
  switch (op.kind) {
    case 'ensure':
      return { kind: op.kind, operation: op, ...target }
    case 'home':
      return { kind: op.kind, operation: op, ...target }
    case 'detach':
      return { kind: op.kind, operation: op, ...target }
  }
}
