import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { CredentialScope } from '../types'

export async function get(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  scope: CredentialScope,
  ref: string,
): Promise<string | undefined> {
  const row = await find(ctx, ownerId, scope, ref)
  return row?.apiKey
}

export async function has(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  scope: CredentialScope,
  ref: string,
): Promise<boolean> {
  return (await find(ctx, ownerId, scope, ref)) !== null
}

/** Every key for a scope, mapped by `ref`, for resolving a whole list at once. */
export async function map(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  scope: CredentialScope,
): Promise<Map<string, string>> {
  const rows = await ctx.db
    .query('credentials')
    .withIndex('by_ownerId_scope_ref', (q) =>
      q.eq('ownerId', ownerId).eq('scope', scope),
    )
    .collect()

  return new Map(rows.map((row) => [row.ref, row.apiKey]))
}

export async function set(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  scope: CredentialScope,
  ref: string,
  apiKey: string,
) {
  const existing = await find(ctx, ownerId, scope, ref)
  const trimmed = apiKey.trim()

  // An empty key clears the credential
  if (!trimmed) {
    if (existing) await ctx.db.delete(existing._id)
    return
  }

  if (existing) {
    await ctx.db.patch(existing._id, { apiKey: trimmed })
  } else {
    await ctx.db.insert('credentials', { ownerId, scope, ref, apiKey: trimmed })
  }
}

export async function remove(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  scope: CredentialScope,
  ref: string,
) {
  const existing = await find(ctx, ownerId, scope, ref)
  if (existing) await ctx.db.delete(existing._id)
}

async function find(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  scope: CredentialScope,
  ref: string,
) {
  return ctx.db
    .query('credentials')
    .withIndex('by_ownerId_scope_ref', (q) =>
      q.eq('ownerId', ownerId).eq('scope', scope).eq('ref', ref),
    )
    .unique()
}
