import type { Doc, Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { FileOperationArgs } from '../../types'
import {
  assertAgentHomeIdle,
  requireOwnedAgent,
  requireOwnedSkill,
} from './access'
import { ensureHome } from './homes'
import type { OperationTargets } from './lifecycle'
import { assertCanRemoveHome } from './removal'

type AgentTarget = {
  agent: Doc<'agents'>
  home: Doc<'agentHomes'>
}

type Prepared<K extends FileOperationArgs['kind'], Targets = object> = {
  [Kind in K]: {
    kind: Kind
    command: Extract<FileOperationArgs, { kind: Kind }>
  } & Targets
}[K]

type InstallArgs = Extract<FileOperationArgs, { kind: 'install' }>

type PreparedInstall =
  | {
      kind: 'install'
      command: Extract<InstallArgs, { source: string }>
      sourceType: 'directory'
    }
  | {
      kind: 'install'
      command: Extract<InstallArgs, { storageId: Id<'_storage'> }>
      sourceType: 'upload'
      upload: Doc<'skillUploads'>
    }

export type PreparedOperation =
  | Prepared<'ensure' | 'home' | 'detach', AgentTarget>
  | Prepared<'duplicate', AgentTarget & { duplicate: AgentTarget }>
  | Prepared<'assign', AgentTarget & { skill: Doc<'skills'> }>
  | Prepared<
      'delete-assigned',
      AgentTarget & { assignment: Doc<'agentSkills'>; skill: Doc<'skills'> }
    >
  | Prepared<'delete-library', { skill: Doc<'skills'> }>
  | PreparedInstall

/** Resolves each command's required resources within its reserving mutation. */
export async function prepareOperation(
  ctx: AuthMutationCtx,
  command: FileOperationArgs,
): Promise<PreparedOperation> {
  switch (command.kind) {
    case 'install':
      return prepareInstall(ctx, command)
    case 'delete-library': {
      const skill = await requireAvailableSkill(
        ctx,
        command.skillId,
        command.kind,
      )
      await assertSkillUnused(ctx, skill._id)
      return { kind: command.kind, command, skill }
    }
    case 'duplicate': {
      const target = await prepareIdleAgent(ctx, command.agentId)
      const duplicate = await prepareAgent(ctx, command.duplicateId)
      return { kind: command.kind, command, ...target, duplicate }
    }
    default:
      return prepareAgentCommand(ctx, command)
  }
}

type AgentCommand = Extract<
  FileOperationArgs,
  { kind: 'ensure' | 'home' | 'detach' | 'assign' | 'delete-assigned' }
>

async function prepareAgentCommand(
  ctx: AuthMutationCtx,
  command: AgentCommand,
): Promise<PreparedOperation> {
  const target = await prepareIdleAgent(ctx, command.agentId)
  switch (command.kind) {
    case 'assign':
      return prepareAssignment(ctx, command, target)
    case 'delete-assigned':
      return prepareAssignedRemoval(ctx, command, target)
    case 'detach':
      if (command.removeFolder)
        await assertCanRemoveHome(ctx, target.home, target.agent._id)
      return { kind: command.kind, command, ...target }
    case 'ensure':
      return { kind: command.kind, command, ...target }
    case 'home':
      return { kind: command.kind, command, ...target }
  }
}

async function prepareAssignment(
  ctx: AuthMutationCtx,
  command: Extract<FileOperationArgs, { kind: 'assign' }>,
  target: AgentTarget,
): Promise<Prepared<'assign', AgentTarget & { skill: Doc<'skills'> }>> {
  const skill = await requireAvailableSkill(ctx, command.skillId, command.kind)
  await assertHomeMissingSkill(ctx, target.home._id, skill.name)
  return { kind: command.kind, command, ...target, skill }
}

async function prepareAssignedRemoval(
  ctx: AuthMutationCtx,
  command: Extract<FileOperationArgs, { kind: 'delete-assigned' }>,
  target: AgentTarget,
): Promise<Extract<PreparedOperation, { kind: 'delete-assigned' }>> {
  const assignment = await requireAssignment(
    ctx,
    command.assignmentId,
    target.home._id,
  )
  const skill = await requireAvailableSkill(
    ctx,
    assignment.skillId,
    command.kind,
  )
  return { kind: command.kind, command, ...target, assignment, skill }
}

async function prepareIdleAgent(ctx: AuthMutationCtx, id: Id<'agents'>) {
  const target = await prepareAgent(ctx, id)
  await assertAgentHomeIdle(ctx, target.agent, target.home)
  return target
}

async function prepareAgent(ctx: AuthMutationCtx, id: Id<'agents'>) {
  const owned = await requireOwnedAgent(ctx, id, ctx.userId)
  const home = await ensureHome(ctx, owned)
  const agent = { ...owned, homeId: home._id }
  return { agent, home }
}

async function prepareInstall(
  ctx: AuthMutationCtx,
  command: InstallArgs,
): Promise<PreparedInstall> {
  if ('source' in command)
    return { kind: command.kind, command, sourceType: 'directory' }

  const upload = await ctx.db
    .query('skillUploads')
    .withIndex('by_storageId', (q) => q.eq('storageId', command.storageId))
    .unique()
  if (!upload || upload.ownerId !== ctx.userId)
    error('Skill upload not found', 404)

  return { kind: command.kind, command, sourceType: 'upload', upload }
}

async function requireAssignment(
  ctx: AuthMutationCtx,
  id: Id<'agentSkills'>,
  homeId: Id<'agentHomes'>,
) {
  const assignment = await ctx.db.get(id)
  const invalid =
    !assignment ||
    assignment.ownerId !== ctx.userId ||
    assignment.homeId !== homeId
  if (invalid) error('Assignment not found', 404)
  return assignment
}

/** Checks library availability for a fresh command or a retry. */
export async function requireAvailableSkill(
  ctx: AuthMutationCtx,
  skillId: Id<'skills'>,
  kind: FileOperationArgs['kind'],
) {
  const skill = await requireOwnedSkill(ctx, skillId, ctx.userId)
  const unavailable =
    skill.operationId || (skill.status !== 'ready' && kind !== 'delete-library')
  if (unavailable) error('Wait for the library operation to finish', 409)
  return skill
}

export async function assertSkillUnused(
  ctx: AuthMutationCtx,
  skillId: Id<'skills'>,
) {
  const assigned = await ctx.db
    .query('agentSkills')
    .withIndex('by_skillId', (q) => q.eq('skillId', skillId))
    .first()
  if (assigned)
    error(
      'Remove this skill from its agents before deleting the library bundle',
      409,
    )
}

export async function assertHomeMissingSkill(
  ctx: AuthMutationCtx,
  homeId: Id<'agentHomes'>,
  name: string,
) {
  const assignment = await ctx.db
    .query('agentSkills')
    .withIndex('by_homeId_name', (q) => q.eq('homeId', homeId).eq('name', name))
    .first()
  if (assignment) error('This skill is already assigned', 409)
}

/** Builds stored command fields from validated resources. */
export function preparedFields(prepared: PreparedOperation) {
  switch (prepared.kind) {
    case 'install':
      return {
        kind: prepared.kind,
        source:
          prepared.sourceType === 'upload'
            ? {
                kind: 'upload' as const,
                storageId: prepared.command.storageId,
                ticket: prepared.upload.ticket,
              }
            : { kind: 'directory' as const, path: prepared.command.source },
        progress: {
          cursor: 0,
          summary: { installed: 0, skipped: 0, failed: 0 },
        },
      }
    case 'duplicate':
      return {
        ...prepared.command,
        homeId: prepared.home._id,
        destinationHomeId: prepared.duplicate.home._id,
      }
    case 'assign':
    case 'delete-assigned':
      return {
        ...prepared.command,
        homeId: prepared.home._id,
        skillId: prepared.skill._id,
      }
    case 'detach':
      return prepared.command.removeFolder
        ? {
            ...prepared.command,
            homeId: prepared.home._id,
            removeFolder: true as const,
          }
        : {
            ...prepared.command,
            homeId: prepared.home._id,
            removeFolder: false as const,
          }
    case 'ensure':
    case 'home':
      return { ...prepared.command, homeId: prepared.home._id }
    case 'delete-library':
      return prepared.command
  }
}

export function preparedTargets(prepared: PreparedOperation): OperationTargets {
  const agents =
    'agent' in prepared
      ? [{ agentId: prepared.agent._id, homeId: prepared.home._id }]
      : []
  if (prepared.kind === 'duplicate')
    agents.push({
      agentId: prepared.duplicate.agent._id,
      homeId: prepared.duplicate.home._id,
    })
  return {
    agents,
    homes: agents.map((agent) => agent.homeId),
    skillId: 'skill' in prepared ? prepared.skill._id : undefined,
  }
}
