import type { Id } from '@sb/convex/_generated/dataModel'

import { ImageTool } from '../io'

const MAX_AVATAR_DIMENSION = 512

export type AvatarUploadResult = {
  avatarId: Id<'avatars'>
}

export async function avatarUploadForm(agentId: Id<'agents'>, file: File) {
  const form = await prepareAvatarUploadForm(file)
  form.set('target', 'agent')
  form.set('agentId', agentId)
  return form
}

export async function profileAvatarUploadForm(file: File) {
  const form = await prepareAvatarUploadForm(file)
  form.set('target', 'profile')
  return form
}

/** Shrink avatars before sending them through the HTTP upload endpoint. */
async function prepareAvatarUploadForm(file: File) {
  const image = await new ImageTool(file)
    .resize(
      { width: MAX_AVATAR_DIMENSION, height: MAX_AVATAR_DIMENSION },
      'inside',
    )
    .format('image/webp')
    .compress(0.85)
    .toBlob()
  const form = new FormData()
  form.set('file', image, 'avatar.webp')
  return form
}
