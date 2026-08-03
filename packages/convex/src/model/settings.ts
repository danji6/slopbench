import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import type { SettingsKey, SettingsPatch } from '../types'
import * as Avatars from './avatars'
import { assertCustomCssCap } from './caps'
import { DEFAULT_SETTINGS, type ResolvedSettings } from './defaults'

export async function getOrDefault(
  ctx: AuthQueryCtx,
): Promise<ResolvedSettings> {
  const doc = await get(ctx)

  if (!doc) {
    return { ...DEFAULT_SETTINGS } as ResolvedSettings
  }

  const { _id: _id, _creationTime: _ct, ownerId: _oid, ...rest } = doc
  return { ...DEFAULT_SETTINGS, ...rest } as ResolvedSettings
}

export async function get(ctx: AuthQueryCtx | AuthMutationCtx) {
  return await getByOwnerId(ctx, ctx.userId)
}

export async function getByOwnerId(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
) {
  return await ctx.db
    .query('settings')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
    .unique()
}

export async function update(
  ctx: AuthMutationCtx,
  { patch }: { patch: SettingsPatch },
) {
  assertCustomCssCap(patch.customCss)

  const existing = await ctx.db
    .query('settings')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ctx.userId))
    .unique()

  if (existing) {
    await ctx.db.patch(existing._id, patch)
  } else {
    await ctx.db.insert('settings', { ownerId: ctx.userId, ...patch })
  }
}

export async function ensureForUser(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  patch: Partial<Doc<'settings'>>,
) {
  const existing = await getByOwnerId(ctx, ownerId)
  if (existing) {
    await ctx.db.patch(existing._id, patch)
    return existing._id
  }
  return ctx.db.insert('settings', { ownerId, ...patch })
}

export async function remove(
  ctx: AuthMutationCtx,
  { key }: { key: SettingsKey },
) {
  const existing = await ctx.db
    .query('settings')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ctx.userId))
    .unique()

  if (existing) {
    await ctx.db.patch(existing._id, { [key]: undefined })
  }
}

export async function clearAvatar(ctx: AuthMutationCtx) {
  const existing = await get(ctx)
  if (!existing?.avatarId) return

  const previousAvatarId = existing.avatarId
  await ctx.db.patch(existing._id, { avatarId: undefined })
  await Avatars.removeIfUnreferenced(ctx, previousAvatarId)
}

export async function confirmAvatarUpload(
  ctx: AuthMutationCtx,
  {
    originalStorageId,
    thumbStorageId,
  }: {
    originalStorageId: Id<'_storage'>
    thumbStorageId: Id<'_storage'>
  },
) {
  const avatarId = await Avatars._create(ctx, {
    storageId: originalStorageId,
    thumbStorageId,
  })

  const existing = await get(ctx)
  if (existing) {
    const previousAvatarId = existing.avatarId
    await ctx.db.patch(existing._id, { avatarId })
    if (previousAvatarId) {
      await Avatars.removeIfUnreferenced(ctx, previousAvatarId)
    }
  } else {
    await ctx.db.insert('settings', {
      ownerId: ctx.userId,
      avatarId,
    })
  }

  return avatarId
}
