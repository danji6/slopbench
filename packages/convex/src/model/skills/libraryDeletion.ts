import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthQueryCtx } from '../../functions'
import type { RemoveDeletedAssignmentArgs } from '../../types'
import { assertMemberIdle, requireAdmin, requireOwnedSkill } from './access'
import { homeMembers } from './homes'
import { holdsOperationReservations, isExecutingOperation } from './lifecycle'

export type LibraryDeletionTarget = {
  home: Doc<'agentHomes'>
  assignment: Doc<'agentSkills'>
}

/** Resolves each assigned copy, including homes that no agent currently uses. */
export async function deletionTargets(
  ctx: QueryCtx,
  skill: Doc<'skills'>,
): Promise<LibraryDeletionTarget[]> {
  const assignments = await ctx.db
    .query('agentSkills')
    .withIndex('by_skillId', (q) => q.eq('skillId', skill._id))
    .collect()

  const targets = []
  for (const assignment of assignments) {
    const home = await ctx.db.get(assignment.homeId)
    if (assignment.ownerId !== skill.ownerId || home?.ownerId !== skill.ownerId)
      error('Assigned skill folder is unavailable or ownership changed', 409)
    targets.push({ home, assignment })
  }

  return targets
}

/** Reports all blocking activity without mutating or claiming resources. */
export async function deletionBlockers(
  ctx: QueryCtx,
  targets: LibraryDeletionTarget[],
  operationId?: Id<'agentFileOperations'>,
) {
  const blockers: string[] = []
  const homes = new Map(targets.map(({ home }) => [home._id, home])).values()

  for (const home of homes) {
    if (home.operationId && home.operationId !== operationId) {
      blockers.push(
        `${home.path ?? 'Personal folder'}: folder operation in progress`,
      )
    }
    for (const member of await homeMembers(ctx, home._id)) {
      if (member.ownerId !== home.ownerId) error('Agent ownership changed', 409)
      try {
        await assertMemberIdle(ctx, member, operationId)
      } catch {
        blockers.push(
          `${member.name}: turns, tools, or a folder operation are still running`,
        )
      }
    }
  }

  return blockers
}

/** Checks every home before the caller atomically claims the deletion. */
export async function prepareLibraryDeletion(
  ctx: QueryCtx,
  skill: Doc<'skills'>,
  operationId?: Id<'agentFileOperations'>,
) {
  const targets = await deletionTargets(ctx, skill)
  const blockers = await deletionBlockers(ctx, targets, operationId)
  if (blockers.length)
    error(`Cannot delete this skill. ${blockers.join('; ')}`, 409)
  return targets
}

/** Shows the current deletion impact, independently of loaded settings pages. */
export async function deletionPreview(
  ctx: AuthQueryCtx,
  { skillId }: { skillId: Id<'skills'> },
) {
  requireAdmin(ctx)
  if (!(await ctx.db.get(skillId))) return null

  const skill = await requireOwnedSkill(ctx, skillId, ctx.userId)
  const targets = await deletionTargets(ctx, skill)
  const blockers = await deletionBlockers(ctx, targets)
  if (skill.operationId) blockers.unshift('A library operation is in progress')

  const homes = []
  const values = new Map(targets.map(({ home }) => [home._id, home])).values()
  for (const home of values) {
    const members = await homeMembers(ctx, home._id)
    homes.push({
      id: home._id,
      path: home.path,
      agents: members.map((agent) => ({ id: agent._id, name: agent.name })),
    })
  }

  return { homes, blockers }
}

/** Records a successfully removed copy only while this attempt owns all its leases. */
export async function removeDeletedAssignment(
  ctx: MutationCtx,
  args: RemoveDeletedAssignmentArgs,
) {
  const op = await ctx.db.get(args.operationId)
  if (!isExecutingOperation(op, args.attempt) || op.kind !== 'delete-library')
    error('Library deletion attempt expired', 409)
  if (op.mode !== 'delete-all' || !(await holdsOperationReservations(ctx, op)))
    error('Library deletion reservation expired', 409)

  const assignment = await ctx.db.get(args.assignmentId)
  if (!assignment) return

  const belongsToDeletion =
    assignment.ownerId === op.ownerId &&
    assignment.skillId === op.skillId &&
    op.homeIds?.includes(assignment.homeId)
  if (!belongsToDeletion) error('Skill assignment changed during deletion', 409)

  await ctx.db.delete(assignment._id)
  await ctx.db.patch(op._id, { updatedAt: Date.now() })
}
