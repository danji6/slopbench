import type { Id } from '@sb/convex/_generated/dataModel'

export type AvatarUploadResult = {
  avatarId: Id<'avatars'>
}

export function avatarUploadForm(agentId: Id<'agents'>, file: File) {
  const form = new FormData()
  form.set('target', 'agent')
  form.set('agentId', agentId)
  form.set('file', file)
  return form
}

export function profileAvatarUploadForm(file: File) {
  const form = new FormData()
  form.set('target', 'profile')
  form.set('file', file)
  return form
}
