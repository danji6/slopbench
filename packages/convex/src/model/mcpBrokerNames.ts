import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'

type Kind = Doc<'mcpBrokerNames'>['kind']

/** Reserves names for immutable targets until the actual session is removed. */
export async function assignName(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  kind: Kind,
  target: string,
  base: string,
) {
  const previous = await ctx.db
    .query('mcpBrokerNames')
    .withIndex('by_target', (q) =>
      q.eq('sessionId', sessionId).eq('kind', kind).eq('target', target),
    )
    .unique()
  if (previous) return previous.name

  const first = await findName(ctx, sessionId, kind, base)
  const name = first ? await suffixedName(ctx, first, base) : base
  await ctx.db.insert('mcpBrokerNames', { sessionId, kind, target, name })
  return name
}

async function suffixedName(
  ctx: MutationCtx,
  first: Doc<'mcpBrokerNames'>,
  base: string,
) {
  let suffix = first.nextSuffix ?? 1
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const name = `${base}_${suffix++}`
    if (await findName(ctx, first.sessionId, first.kind, name)) continue
    await ctx.db.patch(first._id, { nextSuffix: suffix })
    return name
  }
  error('MCP name capacity reached for this session', 409)
}

export function findName(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  kind: Kind,
  name: string,
) {
  return ctx.db
    .query('mcpBrokerNames')
    .withIndex('by_name', (q) =>
      q.eq('sessionId', sessionId).eq('kind', kind).eq('name', name),
    )
    .unique()
}

/** Resolves remembered approvals to immutable identities, never mutable labels. */
export async function approvalTarget(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  input: unknown,
) {
  if (!input || typeof input !== 'object') return
  const tool = (input as { tool?: unknown }).tool
  if (typeof tool !== 'string') return
  const binding = await findName(ctx, sessionId, 'tool', tool)
  const target = binding
    ? await ctx.db.get(binding.target as Id<'mcpCatalogTools'>)
    : null
  return target ? { serverId: target.serverId, toolId: target._id } : undefined
}
