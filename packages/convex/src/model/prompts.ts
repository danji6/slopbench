import {
  MAX_PROMPT_CONTENT_CHARS,
  MAX_PROMPT_NAME_CHARS,
  MAX_SCOPE_PROMPTS,
} from '@sb/core/limits'

import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import type { Prompt, PromptItem, PromptScope } from '../types'
import { promptItemKey } from './prompt/markers'

/** The scopes an agent owns, as opposed to the user-level ones. */
const AGENT_SCOPES = ['own', 'compaction', 'impersonation'] as const

export type PromptSets = {
  own: PromptItem[]
  global: Prompt[]
  library: Prompt[]
  compaction: PromptItem[]
  impersonation: PromptItem[]
}

export async function list(
  ctx: AuthQueryCtx,
  { scope, agentId }: { scope: PromptScope; agentId?: Id<'agents'> },
) {
  await requireScopeOwner(ctx, scope, agentId)
  return agentId
    ? listForAgent(ctx, agentId, scope)
    : listOwned(ctx, ctx.userId, scope)
}

export async function listOwned(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  scope: PromptScope,
) {
  return ctx.db
    .query('prompts')
    .withIndex('by_ownerId_scope_order', (q) =>
      q.eq('ownerId', ownerId).eq('scope', scope),
    )
    .order('asc')
    .collect()
}

export async function listForAgent(
  ctx: QueryCtx | MutationCtx,
  agentId: Id<'agents'>,
  scope: PromptScope,
) {
  return ctx.db
    .query('prompts')
    .withIndex('by_agentId_scope_order', (q) =>
      q.eq('agentId', agentId).eq('scope', scope),
    )
    .order('asc')
    .collect()
}

/**
 * Every prompt set a stream needs, resolved in one pass. Compaction and
 * impersonation fall back to the owner's sets when the agent defines none.
 */
export async function resolveSets(
  ctx: QueryCtx | MutationCtx,
  agent: Pick<Doc<'agents'>, '_id' | 'ownerId'>,
): Promise<PromptSets> {
  const [own, global, library, agentCompaction, agentImpersonation] =
    await Promise.all([
      listForAgent(ctx, agent._id, 'own'),
      listOwned(ctx, agent.ownerId, 'global'),
      listOwned(ctx, agent.ownerId, 'library'),
      listForAgent(ctx, agent._id, 'compaction'),
      listForAgent(ctx, agent._id, 'impersonation'),
    ])

  const compaction = agentCompaction.length
    ? agentCompaction
    : await listOwned(ctx, agent.ownerId, 'compaction')
  const impersonation = agentImpersonation.length
    ? agentImpersonation
    : await listOwned(ctx, agent.ownerId, 'impersonation')

  return {
    own: toItems(own),
    global: toItems(global) as Prompt[],
    library: toItems(library) as Prompt[],
    compaction: toItems(compaction),
    impersonation: toItems(impersonation),
  }
}

export function toItems(rows: Doc<'prompts'>[]): PromptItem[] {
  return rows.map((row) => row.item)
}

export async function create(
  ctx: AuthMutationCtx,
  {
    scope,
    agentId,
    item,
    index,
  }: {
    scope: PromptScope
    agentId?: Id<'agents'>
    item: PromptItem
    index?: number
  },
) {
  await requireScopeOwner(ctx, scope, agentId)
  assertItemWithinCaps(item)

  const rows = await listScope(ctx, ctx.userId, scope, agentId)
  if (rows.length >= MAX_SCOPE_PROMPTS) {
    error(`Prompts limit exceeded (max: ${MAX_SCOPE_PROMPTS})`, 400)
  }

  const key = promptItemKey(item)
  if (rows.some((row) => row.key === key)) error('Duplicate prompt', 409)

  const at = index ?? rows.length
  const id = await ctx.db.insert('prompts', {
    ownerId: ctx.userId,
    ...(agentId ? { agentId } : {}),
    scope,
    order: at,
    key,
    item,
  })

  await reindex(ctx, [
    ...rows.slice(0, at),
    { _id: id } as Doc<'prompts'>,
    ...rows.slice(at),
  ])

  return id
}

export async function update(
  ctx: AuthMutationCtx,
  { promptId, item }: { promptId: Id<'prompts'>; item: PromptItem },
) {
  const row = await requireOwned(ctx, promptId)
  assertItemWithinCaps(item)
  await ctx.db.patch(row._id, { key: promptItemKey(item), item })
}

export async function remove(
  ctx: AuthMutationCtx,
  { promptId }: { promptId: Id<'prompts'> },
) {
  const row = await requireOwned(ctx, promptId)
  await ctx.db.delete(row._id)
  await reindex(ctx, await listScope(ctx, row.ownerId, row.scope, row.agentId))
}

/** Rewrites the whole scope's order from a list of ids. */
export async function reorder(
  ctx: AuthMutationCtx,
  {
    scope,
    agentId,
    promptIds,
  }: { scope: PromptScope; agentId?: Id<'agents'>; promptIds: Id<'prompts'>[] },
) {
  await requireScopeOwner(ctx, scope, agentId)
  const rows = await listScope(ctx, ctx.userId, scope, agentId)
  const byId = new Map(rows.map((row) => [row._id, row]))

  const ordered = promptIds
    .map((id) => byId.get(id))
    .filter((row): row is Doc<'prompts'> => row !== undefined)

  // Anything the client didn't mention keeps its relative position at the end
  const mentioned = new Set(ordered.map((row) => row._id))
  await reindex(ctx, [
    ...ordered,
    ...rows.filter((row) => !mentioned.has(row._id)),
  ])
}

type PromptScopeOptions = {
  scope: PromptScope
  agentId?: Id<'agents'>
  items: PromptItem[]
}

/** Replaces a whole scope from an edited list, diffed onto the existing rows. */
export async function replaceScope(
  ctx: AuthMutationCtx,
  { scope, agentId, items }: PromptScopeOptions,
) {
  await requireScopeOwner(ctx, scope, agentId)

  if (items.length > MAX_SCOPE_PROMPTS) {
    error(`Prompts limit exceeded (max: ${MAX_SCOPE_PROMPTS})`, 400)
  }
  for (const item of items) assertItemWithinCaps(item)

  const existing = await listScope(ctx, ctx.userId, scope, agentId)
  const byKey = new Map(existing.map((row) => [row.key, row]))
  const seen = new Set<string>()

  for (const [order, item] of items.entries()) {
    const key = promptItemKey(item)
    if (seen.has(key)) continue
    seen.add(key)

    const row = byKey.get(key)
    if (row) {
      await ctx.db.patch(row._id, { order, item })
    } else {
      await ctx.db.insert('prompts', {
        ownerId: ctx.userId,
        ...(agentId ? { agentId } : {}),
        scope,
        order,
        key,
        item,
      })
    }
  }

  for (const row of existing) {
    if (!seen.has(row.key)) await ctx.db.delete(row._id)
  }
}

/** Copies one agent's whole prompt set onto another, for duplication. */
export async function copyForAgent(
  ctx: MutationCtx,
  from: Id<'agents'>,
  to: Id<'agents'>,
  ownerId: Id<'users'>,
) {
  for (const scope of AGENT_SCOPES) {
    for (const row of await listForAgent(ctx, from, scope)) {
      await ctx.db.insert('prompts', {
        ownerId,
        agentId: to,
        scope,
        order: row.order,
        key: row.key,
        item: row.item,
      })
    }
  }
}

export async function removeForAgent(ctx: MutationCtx, agentId: Id<'agents'>) {
  for (const scope of AGENT_SCOPES) {
    for (const row of await listForAgent(ctx, agentId, scope)) {
      await ctx.db.delete(row._id)
    }
  }
}

/** Seeds a scope that has no rows yet, used for agent creation defaults. */
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
    scope: PromptScope
    items: PromptItem[]
  },
) {
  for (const [order, item] of items.entries()) {
    await ctx.db.insert('prompts', {
      ownerId,
      ...(agentId ? { agentId } : {}),
      scope,
      order,
      key: promptItemKey(item),
      item,
    })
  }
}

function listScope(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  scope: PromptScope,
  agentId: Id<'agents'> | undefined,
) {
  return agentId
    ? listForAgent(ctx, agentId, scope)
    : listOwned(ctx, ownerId, scope)
}

async function reindex(ctx: MutationCtx, rows: { _id: Id<'prompts'> }[]) {
  for (const [order, row] of rows.entries()) {
    await ctx.db.patch(row._id, { order })
  }
}

async function requireOwned(ctx: AuthMutationCtx, promptId: Id<'prompts'>) {
  const row = await ctx.db.get(promptId)
  if (!row || row.ownerId !== ctx.userId) error('Not found', 404)
  return row
}

async function requireScopeOwner(
  ctx: AuthQueryCtx | AuthMutationCtx,
  scope: PromptScope,
  agentId: Id<'agents'> | undefined,
) {
  const agentScope = (AGENT_SCOPES as readonly string[]).includes(scope)
  if (scope === 'own' && !agentId) error('Own prompts need an agent', 400)
  if (agentId && !agentScope) error(`${scope} prompts are user-owned`, 400)
  if (!agentId) return

  const agent = await ctx.db.get(agentId)
  if (!agent || agent.ownerId !== ctx.userId) error('Not found', 404)
}

function assertItemWithinCaps(item: PromptItem) {
  if ('type' in item) return
  if (item.content.length > MAX_PROMPT_CONTENT_CHARS) {
    error(`Prompt exceeds ${MAX_PROMPT_CONTENT_CHARS} characters`, 400)
  }
  if (item.name.length > MAX_PROMPT_NAME_CHARS) {
    error(`Prompt name exceeds ${MAX_PROMPT_NAME_CHARS} characters`, 400)
  }
}
