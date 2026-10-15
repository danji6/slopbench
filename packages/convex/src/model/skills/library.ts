import type { PaginationOptions } from 'convex/server'

import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { AuthQueryCtx } from '../../functions'
import type { SkillListArgs } from '../../types'
import { requireAdmin, requireOwnedAgent } from './access'

/** Includes assignment state from the whole home, independent of client-loaded pages. */
export async function list(ctx: AuthQueryCtx, args: SkillListArgs) {
  requireAdmin(ctx)

  const agent = args.agentId
    ? await requireOwnedAgent(ctx, args.agentId, ctx.userId)
    : null
  const prefix = args.search?.trim().toLowerCase() ?? ''
  if (agent && args.assignment === 'added') {
    return addedSkills(ctx, agent._id, args.paginationOpts, prefix)
  }
  const result = await ctx.db
    .query('skills')
    .withIndex('by_ownerId_name', (q) => {
      const owned = q.eq('ownerId', ctx.userId)
      return prefix
        ? owned.gte('name', prefix).lt('name', `${prefix}\uffff`)
        : owned
    })
    .paginate(args.paginationOpts)
  const skills = await Promise.all(
    result.page.map(async (skill) => {
      const assignment = agent?.homeId
        ? await ctx.db
            .query('agentSkills')
            .withIndex('by_homeId_name', (q) =>
              q.eq('homeId', agent.homeId!).eq('name', skill.name),
            )
            .first()
        : null
      return { ...skill, assignmentId: assignment?._id ?? null }
    }),
  )

  const page =
    args.assignment === 'not-added'
      ? skills.filter((skill) => !skill.assignmentId)
      : skills
  return { ...result, page }
}

async function addedSkills(
  ctx: AuthQueryCtx,
  agentId: Id<'agents'>,
  options: PaginationOptions,
  prefix: string,
) {
  const result = await assignmentPage(ctx, agentId, options, prefix)
  const skills = await Promise.all(
    result.page.map(async (assignment) => {
      const skill = await ctx.db.get(assignment.skillId)
      return skill ? { ...skill, assignmentId: assignment._id } : null
    }),
  )
  return { ...result, page: skills.filter((skill) => skill !== null) }
}

export async function assigned(
  ctx: AuthQueryCtx,
  args: { agentId: Id<'agents'>; paginationOpts: PaginationOptions },
) {
  requireAdmin(ctx)
  await requireOwnedAgent(ctx, args.agentId, ctx.userId)
  return assignmentPage(ctx, args.agentId, args.paginationOpts)
}

export async function assignmentPage(
  ctx: QueryCtx,
  agentId: Id<'agents'>,
  options: PaginationOptions,
  prefix = '',
) {
  const agent = await ctx.db.get(agentId)
  if (!agent?.homeId) return { page: [], isDone: true, continueCursor: '' }
  return ctx.db
    .query('agentSkills')
    .withIndex('by_homeId_name', (q) => {
      const home = q.eq('homeId', agent.homeId!)
      return prefix
        ? home.gte('name', prefix).lt('name', `${prefix}\uffff`)
        : home
    })
    .paginate(options)
}
