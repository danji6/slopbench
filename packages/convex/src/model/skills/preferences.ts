import type { Doc, Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { SetSkillEnabledArgs } from '../../types'
import { requireAdmin, requireOwnedAgent } from './access'

export function isSkillEnabled(
  agent: Pick<Doc<'agents'>, 'disabledSkillIds'> | null,
  skillId: Id<'skills'>,
) {
  return !agent?.disabledSkillIds?.includes(skillId)
}

/** Changes catalog visibility for one agent without touching shared files. */
export async function setEnabled(
  ctx: AuthMutationCtx,
  { agentId, assignmentId, enabled }: SetSkillEnabledArgs,
) {
  requireAdmin(ctx)

  const agent = await requireOwnedAgent(ctx, agentId, ctx.userId)
  const assignment = await ctx.db.get(assignmentId)

  if (!assignment || assignment.ownerId !== ctx.userId) {
    error('Skill assignment not found', 404)
  }
  if (assignment.homeId !== agent.homeId) {
    error('Skill is not assigned to this agent', 400)
  }

  const disabled = new Set(agent.disabledSkillIds)
  if (enabled) disabled.delete(assignment.skillId)
  else disabled.add(assignment.skillId)

  await ctx.db.patch(agentId, { disabledSkillIds: [...disabled] })
}
