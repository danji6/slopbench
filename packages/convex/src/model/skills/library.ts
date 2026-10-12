import { SKILL_PAGE_SIZE } from '@sb/core/skills/types'
import type { PaginationOptions } from 'convex/server'

import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { AuthQueryCtx } from '../../functions'
import { requireAdmin, requireOwnedAgent } from './access'

export async function list(
  ctx: AuthQueryCtx,
  args: { paginationOpts: PaginationOptions; search?: string },
) {
  requireAdmin(ctx)
  const prefix = args.search?.trim().toLowerCase() ?? ''
  return ctx.db
    .query('skills')
    .withIndex('by_ownerId_name', (q) => {
      const owned = q.eq('ownerId', ctx.userId)
      return prefix
        ? owned.gte('name', prefix).lt('name', `${prefix}\uffff`)
        : owned
    })
    .paginate({
      ...args.paginationOpts,
      numItems: Math.min(SKILL_PAGE_SIZE, args.paginationOpts.numItems),
    })
}

export async function assigned(
  ctx: AuthQueryCtx,
  args: { agentId: Id<'agents'>; paginationOpts: PaginationOptions },
) {
  requireAdmin(ctx)
  await requireOwnedAgent(ctx, args.agentId, ctx.userId)
  return assignmentPage(ctx, args.agentId, args.paginationOpts)
}

export function assignmentPage(
  ctx: QueryCtx,
  agentId: Id<'agents'>,
  options: PaginationOptions,
  prefix = '',
) {
  return ctx.db
    .query('agentSkills')
    .withIndex('by_agentId_name', (q) => {
      const owned = q.eq('agentId', agentId)
      return prefix
        ? owned.gte('name', prefix).lt('name', `${prefix}\uffff`)
        : owned
    })
    .paginate({
      ...options,
      numItems: Math.min(SKILL_PAGE_SIZE, options.numItems),
    })
}
