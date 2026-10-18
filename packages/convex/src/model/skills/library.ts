import type { PaginationOptions } from 'convex/server'

import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { AuthQueryCtx } from '../../functions'
import type { SkillListArgs } from '../../types'
import { requireAdmin, requireOwnedAgent } from './access'
import { isSkillEnabled } from './preferences'
import { allAgentSkills, assignedSkillItem } from './skillListing'

/** Includes assignment state from the whole home, independent of client-loaded pages. */
export async function list(ctx: AuthQueryCtx, args: SkillListArgs) {
  requireAdmin(ctx)

  const agent = args.agentId
    ? await requireOwnedAgent(ctx, args.agentId, ctx.userId)
    : null
  const prefix = args.search?.trim().toLowerCase() ?? ''

  if (agent && args.assignment === 'added') {
    return addedSkills(ctx, agent, args.paginationOpts, prefix)
  }
  if (agent) {
    return allAgentSkills(
      ctx,
      agent,
      args.paginationOpts,
      prefix,
      args.assignment === 'not-added',
    )
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

  return {
    ...result,
    page: result.page.map((skill) => ({
      ...skill,
      assignmentId: null,
      enabled: true,
      libraryAvailable: true,
    })),
  }
}

async function addedSkills(
  ctx: AuthQueryCtx,
  agent: Doc<'agents'>,
  options: PaginationOptions,
  prefix: string,
) {
  const result = await assignmentPage(ctx, agent._id, options, prefix)
  const page = await Promise.all(
    result.page.map((assignment) => assignedSkillItem(ctx, agent, assignment)),
  )
  return { ...result, page }
}

export async function assigned(
  ctx: AuthQueryCtx,
  args: { agentId: Id<'agents'>; paginationOpts: PaginationOptions },
) {
  requireAdmin(ctx)
  await requireOwnedAgent(ctx, args.agentId, ctx.userId)
  return assignmentPage(ctx, args.agentId, args.paginationOpts)
}

/** Keeps every assignment for file operations unless a catalog requests enabled skills. */
export async function assignmentPage(
  ctx: QueryCtx,
  agentId: Id<'agents'>,
  options: PaginationOptions,
  prefix = '',
  enabledOnly = false,
) {
  const agent = await ctx.db.get(agentId)
  if (!agent?.homeId) {
    return { page: [], isDone: true, continueCursor: '' }
  }

  const result = await ctx.db
    .query('agentSkills')
    .withIndex('by_homeId_name', (q) => {
      const home = q.eq('homeId', agent.homeId!)
      return prefix
        ? home.gte('name', prefix).lt('name', `${prefix}\uffff`)
        : home
    })
    .paginate(options)

  return {
    ...result,
    page: enabledOnly
      ? result.page.filter((row) => isSkillEnabled(agent, row.skillId))
      : result.page,
  }
}

/** Reports whether an assignment can still be reinstalled from its library bundle. */
export async function assignmentLibrary(
  ctx: QueryCtx,
  { assignmentId }: { assignmentId: Id<'agentSkills'> },
) {
  const row = await ctx.db.get(assignmentId)
  return row ? !!(await ctx.db.get(row.skillId)) : false
}
