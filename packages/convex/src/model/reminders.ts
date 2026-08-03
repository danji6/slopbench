import { limitError } from '@sb/core/limit-errors'
import {
  MAX_PROMPT_CONTENT_CHARS,
  MAX_PROMPT_NAME_CHARS,
  MAX_SCOPE_PROMPTS,
} from '@sb/core/limits'
import type { ReminderPrompt } from '@sb/core/types'

import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import type { ReminderScope } from '../types'

export async function list(
  ctx: AuthQueryCtx,
  { scope, agentId }: { scope: ReminderScope; agentId?: Id<'agents'> },
) {
  await requireScopeOwner(ctx, scope, agentId)
  return agentId
    ? listForAgent(ctx, agentId)
    : listOwned(ctx, ctx.userId, scope)
}

export async function listOwned(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  scope: ReminderScope,
) {
  return ctx.db
    .query('reminders')
    .withIndex('by_ownerId_scope_order', (q) =>
      q.eq('ownerId', ownerId).eq('scope', scope),
    )
    .order('asc')
    .collect()
}

export async function listForAgent(
  ctx: QueryCtx | MutationCtx,
  agentId: Id<'agents'>,
) {
  return ctx.db
    .query('reminders')
    .withIndex('by_agentId_scope_order', (q) =>
      q.eq('agentId', agentId).eq('scope', 'own'),
    )
    .order('asc')
    .collect()
}

/** An agent's own reminders plus the owner's library. */
export async function resolveSets(
  ctx: QueryCtx | MutationCtx,
  agent: Pick<Doc<'agents'>, '_id' | 'ownerId'>,
): Promise<{ own: ReminderPrompt[]; library: ReminderPrompt[] }> {
  const [own, library] = await Promise.all([
    listForAgent(ctx, agent._id),
    listOwned(ctx, agent.ownerId, 'library'),
  ])
  return { own: toItems(own), library: toItems(library) }
}

export function toItems(rows: Doc<'reminders'>[]): ReminderPrompt[] {
  return rows.map((row) => row.item)
}

export async function create(
  ctx: AuthMutationCtx,
  {
    scope,
    agentId,
    item,
  }: { scope: ReminderScope; agentId?: Id<'agents'>; item: ReminderPrompt },
) {
  await requireScopeOwner(ctx, scope, agentId)
  assertItemWithinCaps(item)

  const rows = await listScope(ctx, ctx.userId, scope, agentId)
  if (rows.length >= MAX_SCOPE_PROMPTS) {
    error(limitError('reminders'), 400)
  }
  if (rows.some((row) => row.key === item.id)) error('Duplicate reminder', 409)

  return ctx.db.insert('reminders', {
    ownerId: ctx.userId,
    ...(agentId ? { agentId } : {}),
    scope,
    order: rows.length,
    key: item.id,
    item,
  })
}

export async function update(
  ctx: AuthMutationCtx,
  { reminderId, item }: { reminderId: Id<'reminders'>; item: ReminderPrompt },
) {
  const row = await requireOwned(ctx, reminderId)
  assertItemWithinCaps(item)
  await ctx.db.patch(row._id, { key: item.id, item })
}

export async function remove(
  ctx: AuthMutationCtx,
  { reminderId }: { reminderId: Id<'reminders'> },
) {
  const row = await requireOwned(ctx, reminderId)
  await ctx.db.delete(row._id)
  await reindex(ctx, await listScope(ctx, row.ownerId, row.scope, row.agentId))
}

type ReminderScopeOptions = {
  scope: ReminderScope
  agentId?: Id<'agents'>
  items: ReminderPrompt[]
}

/** Replaces a whole scope from an edited list, diffed onto the existing rows. */
export async function replaceScope(
  ctx: AuthMutationCtx,
  { scope, agentId, items }: ReminderScopeOptions,
) {
  await requireScopeOwner(ctx, scope, agentId)

  if (items.length > MAX_SCOPE_PROMPTS) {
    error(limitError('reminders'), 400)
  }
  for (const item of items) assertItemWithinCaps(item)

  const existing = await listScope(ctx, ctx.userId, scope, agentId)
  const byKey = new Map(existing.map((row) => [row.key, row]))
  const seen = new Set<string>()

  for (const [order, item] of items.entries()) {
    if (seen.has(item.id)) continue
    seen.add(item.id)

    const row = byKey.get(item.id)
    if (row) {
      await ctx.db.patch(row._id, { order, item })
    } else {
      await ctx.db.insert('reminders', {
        ownerId: ctx.userId,
        ...(agentId ? { agentId } : {}),
        scope,
        order,
        key: item.id,
        item,
      })
    }
  }

  for (const row of existing) {
    if (!seen.has(row.key)) await ctx.db.delete(row._id)
  }
}

export async function copyForAgent(
  ctx: MutationCtx,
  from: Id<'agents'>,
  to: Id<'agents'>,
  ownerId: Id<'users'>,
) {
  for (const row of await listForAgent(ctx, from)) {
    await ctx.db.insert('reminders', {
      ownerId,
      agentId: to,
      scope: 'own',
      order: row.order,
      key: row.key,
      item: row.item,
    })
  }
}

export async function removeForAgent(ctx: MutationCtx, agentId: Id<'agents'>) {
  for (const row of await listForAgent(ctx, agentId)) {
    await ctx.db.delete(row._id)
  }
}

export async function seed(
  ctx: MutationCtx,
  {
    ownerId,
    agentId,
    scope,
    items,
  }: {
    ownerId: Id<'users'>
    agentId?: Id<'agents'>
    scope: ReminderScope
    items: ReminderPrompt[]
  },
) {
  for (const [order, item] of items.entries()) {
    await ctx.db.insert('reminders', {
      ownerId,
      ...(agentId ? { agentId } : {}),
      scope,
      order,
      key: item.id,
      item,
    })
  }
}

function listScope(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  scope: ReminderScope,
  agentId: Id<'agents'> | undefined,
) {
  return agentId ? listForAgent(ctx, agentId) : listOwned(ctx, ownerId, scope)
}

async function reindex(ctx: MutationCtx, rows: { _id: Id<'reminders'> }[]) {
  for (const [order, row] of rows.entries()) {
    await ctx.db.patch(row._id, { order })
  }
}

async function requireOwned(ctx: AuthMutationCtx, reminderId: Id<'reminders'>) {
  const row = await ctx.db.get(reminderId)
  if (!row || row.ownerId !== ctx.userId) error('Not found', 404)
  return row
}

async function requireScopeOwner(
  ctx: AuthQueryCtx | AuthMutationCtx,
  scope: ReminderScope,
  agentId: Id<'agents'> | undefined,
) {
  if (scope === 'own' && !agentId) error('Own reminders need an agent', 400)
  if (scope === 'library' && agentId)
    error('Library reminders are user-owned', 400)
  if (!agentId) return

  const agent = await ctx.db.get(agentId)
  if (!agent || agent.ownerId !== ctx.userId) error('Not found', 404)
}

function assertItemWithinCaps(item: ReminderPrompt) {
  if (item.content.length > MAX_PROMPT_CONTENT_CHARS) {
    error(limitError('reminderContent'), 400)
  }
  if (item.name.length > MAX_PROMPT_NAME_CHARS) {
    error(limitError('reminderName'), 400)
  }
}
