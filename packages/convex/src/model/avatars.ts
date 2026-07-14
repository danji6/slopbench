import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

export async function _create(
  ctx: MutationCtx,
  {
    storageId,
    thumbStorageId,
  }: { storageId: Id<'_storage'>; thumbStorageId: Id<'_storage'> },
): Promise<Id<'avatars'>> {
  return ctx.db.insert('avatars', { storageId, thumbStorageId })
}

export async function removeIfUnreferenced(
  ctx: MutationCtx,
  avatarId: Id<'avatars'>,
): Promise<void> {
  const [agent, settings, message] = await Promise.all([
    ctx.db
      .query('agents')
      .withIndex('by_avatarId', (q) => q.eq('avatarId', avatarId))
      .first(),
    ctx.db
      .query('settings')
      .withIndex('by_avatarId', (q) => q.eq('avatarId', avatarId))
      .first(),
    ctx.db
      .query('messages')
      .withIndex('by_snapshotAvatarId', (q) =>
        q.eq('senderSnapshot.avatarId', avatarId),
      )
      .first(),
  ])
  if (agent || settings || message) return

  const avatar = await ctx.db.get(avatarId)
  if (!avatar) return
  await ctx.storage.delete(avatar.storageId).catch(() => {})
  await ctx.storage.delete(avatar.thumbStorageId).catch(() => {})
  await ctx.db.delete(avatarId)
}

export async function getUrls(
  ctx: QueryCtx,
  avatarId: Id<'avatars'>,
): Promise<{ original: string | null; thumbnail: string | null }> {
  const avatar = await ctx.db.get(avatarId)
  if (!avatar) return { original: null, thumbnail: null }
  const [original, thumbnail] = await Promise.all([
    ctx.storage.getUrl(avatar.storageId),
    ctx.storage.getUrl(avatar.thumbStorageId),
  ])
  return { original, thumbnail }
}

export async function getUrlMap(
  ctx: QueryCtx,
  { ids }: { ids: Id<'avatars'>[] },
): Promise<
  Record<string, { original: string | null; thumbnail: string | null }>
> {
  const entries = await Promise.all(
    [...new Set(ids)].map(async (id) => [id, await getUrls(ctx, id)] as const),
  )
  return Object.fromEntries(entries)
}
