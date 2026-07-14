import type { QueryCtx } from '../_generated/server'
import {
  type AuthMutationCtx,
  type AuthQueryCtx,
  findUserBySubject,
} from '../functions'
import * as Settings from './settings'

export async function getProfile(ctx: AuthQueryCtx) {
  return ctx.db.get(ctx.userId)
}

export async function _getRoleBySubject(
  ctx: QueryCtx,
  { subject }: { subject: string },
) {
  const user = await findUserBySubject(ctx, subject)
  return user?.role ?? null
}

export async function ensureProfile(ctx: AuthMutationCtx) {
  return ctx.db.get(ctx.userId)
}

export async function updateProfile(
  ctx: AuthMutationCtx,
  args: { displayName?: string },
) {
  await Settings.update(ctx, { patch: args })
}

export async function clearAvatar(ctx: AuthMutationCtx) {
  await Settings.clearAvatar(ctx)
}

export async function generateAvatarUploadUrl(ctx: AuthMutationCtx) {
  return ctx.storage.generateUploadUrl()
}

export async function confirmAvatarUpload(
  ctx: AuthMutationCtx,
  args: Parameters<typeof Settings.confirmAvatarUpload>[1],
) {
  return Settings.confirmAvatarUpload(ctx, args)
}
