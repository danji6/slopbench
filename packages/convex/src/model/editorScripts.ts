import type { Id } from '../_generated/dataModel'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import type { CreateScriptArgs, UpdateScriptArgs } from '../types'

export async function list(ctx: AuthQueryCtx) {
  return ctx.db
    .query('editorScripts')
    .withIndex('by_ownerId_order', (q) => q.eq('ownerId', ctx.userId))
    .order('asc')
    .collect()
}

export async function get(
  ctx: AuthQueryCtx,
  { scriptId }: { scriptId: Id<'editorScripts'> },
) {
  const script = await ctx.db.get(scriptId)
  if (!script || script.ownerId !== ctx.userId) return null
  return script
}

export async function create(ctx: AuthMutationCtx, args: CreateScriptArgs) {
  return ctx.db.insert('editorScripts', {
    name: args.name,
    code: args.code,
    icon: args.icon ?? '',
    pinned: args.pinned ?? false,
    order: args.order ?? (await getNextOrder(ctx)),
    ownerId: ctx.userId,
  })
}

export async function update(
  ctx: AuthMutationCtx,
  { scriptId, ...patch }: UpdateScriptArgs,
) {
  const script = await ctx.db.get(scriptId)
  if (!script || script.ownerId !== ctx.userId) error('Not found', 404)
  await ctx.db.patch(scriptId, patch)
}

export async function remove(
  ctx: AuthMutationCtx,
  { scriptId }: { scriptId: Id<'editorScripts'> },
) {
  const script = await ctx.db.get(scriptId)
  if (!script || script.ownerId !== ctx.userId) error('Not found', 404)
  await ctx.db.delete(scriptId)
}

async function getNextOrder(ctx: AuthMutationCtx) {
  const lastScript = await ctx.db
    .query('editorScripts')
    .withIndex('by_ownerId_order', (q) => q.eq('ownerId', ctx.userId))
    .order('desc')
    .first()

  return lastScript ? lastScript.order + 1 : 0
}
