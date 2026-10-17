import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthQueryCtx } from '../../functions'
import type { RemoveMissingSkillArgs, VerifySkillIdsArgs } from '../../types'
import { assertAgentIdle, requireAdmin, requireOwnedSkill } from './access'
import { homeMembers } from './homes'

/** Resolves a bounded set of confirmation candidates with current ownership checks. */
export async function verificationTargets(
  ctx: AuthQueryCtx,
  { skillIds }: VerifySkillIdsArgs,
) {
  requireAdmin(ctx)
  if (skillIds.length > 20) error('Check at most 20 skills at a time', 400)
  const skills = []
  for (const skillId of new Set(skillIds)) {
    const skill = await ctx.db.get(skillId)
    if (!skill) continue
    skills.push(await requireOwnedSkill(ctx, skillId, ctx.userId))
  }
  return skills
}

/** Removes stale catalog references atomically, preserving any surviving agent files. */
export async function removeMissingSkill(
  ctx: MutationCtx,
  args: RemoveMissingSkillArgs,
) {
  const skill = await ctx.db.get(args.skillId)
  if (!skill) return false
  if (skill.ownerId !== args.ownerId) error('Skill not found', 404)
  const changed =
    skill.operationId ||
    skill.status === 'installing' ||
    skill.importOperationId !== args.importOperationId
  if (changed) return false

  const assignments = await ctx.db
    .query('agentSkills')
    .withIndex('by_skillId', (q) => q.eq('skillId', skill._id))
    .collect()
  const homes = new Set(assignments.map((row) => row.homeId))
  await assertHomesIdle(ctx, homes, args.ownerId)
  for (const assignment of assignments) await ctx.db.delete(assignment._id)
  await ctx.db.delete(skill._id)
  return true
}

async function assertHomesIdle(
  ctx: MutationCtx,
  homes: Set<Id<'agentHomes'>>,
  ownerId: Id<'users'>,
) {
  for (const homeId of homes) {
    const home = await ctx.db.get(homeId)
    if (home?.operationId)
      error('Wait for the shared folder operation to finish', 409)
    for (const member of await homeMembers(ctx, homeId)) {
      await assertAgentIdle(ctx, member._id, ownerId)
    }
  }
}
