'use node'

import { api, internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { error } from '../../errors'
import { decodeBase64 } from '../../model/io/base64'
import { postSidecar } from '../../model/sidecar'

type ThumbnailImageResult = {
  contentType: string
  data: string
}

type PngImageResult = {
  contentType: string
  data: string
}

export type AvatarUploadTarget =
  | { target: 'agent'; agentId: Id<'agents'>; file: Blob }
  | { target: 'profile'; file: Blob }

export async function uploadAvatar(
  ctx: ActionCtx,
  args: AvatarUploadTarget,
): Promise<{ avatarId: Id<'avatars'> }> {
  const uploadStorageId = await ctx.storage.store(args.file)
  let originalStorageId: Id<'_storage'> | undefined
  let thumbStorageId: Id<'_storage'> | undefined

  try {
    originalStorageId = await generateAvatarPng(ctx, uploadStorageId)
    await ctx.storage.delete(uploadStorageId).catch(() => {})

    thumbStorageId = await generateAvatarThumbnail(ctx, originalStorageId)

    // The profile confirm creates the avatar record itself (and swaps out any
    // previous one), so we hand it the raw storage ids rather than pre-creating.
    if (args.target === 'profile') {
      const avatarId = await ctx.runMutation(api.users.confirmAvatarUpload, {
        originalStorageId,
        thumbStorageId,
      })
      return { avatarId }
    }

    const avatarId = await ctx.runMutation(internal.avatars._create, {
      storageId: originalStorageId,
      thumbStorageId,
    })
    await ctx.runMutation(api.agents.confirmAvatarUpload, {
      agentId: args.agentId,
      avatarId,
    })
    return { avatarId }
  } catch (err) {
    await ctx.storage.delete(uploadStorageId).catch(() => {})

    if (originalStorageId) {
      await ctx.storage.delete(originalStorageId).catch(() => {})
    }

    if (thumbStorageId) {
      await ctx.storage.delete(thumbStorageId).catch(() => {})
    }

    throw err
  }
}

async function generateAvatarPng(
  ctx: ActionCtx,
  uploadStorageId: Id<'_storage'>,
): Promise<Id<'_storage'>> {
  const imageUrl = await ctx.storage.getUrl(uploadStorageId)
  if (!imageUrl) error('Avatar storage URL not found', 500)

  const image = await postSidecar<PngImageResult>('/io/image/png', { imageUrl })

  return ctx.storage.store(
    new Blob([decodeBase64(image.data)], { type: image.contentType }),
  ) as Promise<Id<'_storage'>>
}

export async function generateAvatarThumbnail(
  ctx: ActionCtx,
  originalStorageId: Id<'_storage'>,
): Promise<Id<'_storage'>> {
  const imageUrl = await ctx.storage.getUrl(originalStorageId)
  if (!imageUrl) error('Avatar storage URL not found', 500)

  const thumbnail = await postSidecar<ThumbnailImageResult>(
    '/io/image/thumbnail',
    { imageUrl },
  )

  return ctx.storage.store(
    new Blob([decodeBase64(thumbnail.data)], { type: thumbnail.contentType }),
  ) as Promise<Id<'_storage'>>
}
