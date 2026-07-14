import { useHttpAction } from '@/hooks/http'
import {
  type AvatarUploadResult,
  profileAvatarUploadForm,
} from '@/lib/chat/avatar'
import { useMutation, useQuery } from 'convex/react'
import { useCallback } from 'react'
import { api } from '@sb/convex/_generated/api'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'

import { useAvatarThumbnail } from './avatars'

export function useUserProfile(): Doc<'users'> | null {
  return useQuery(api.users.getProfile) ?? null
}

export function useUpdateProfile() {
  const update = useMutation(api.users.updateProfile)
  return useCallback((displayName: string) => update({ displayName }), [update])
}

export function useClearProfileAvatar() {
  const clear = useMutation(api.users.clearAvatar)
  return useCallback(() => clear({}), [clear])
}

export function useAvatarUrl(
  avatarId: Id<'avatars'> | undefined,
): string | null {
  return useAvatarThumbnail(avatarId)
}

export function useUploadProfileAvatar() {
  const { call } = useHttpAction<FormData, AvatarUploadResult>(
    '/io/avatar/upload',
  )
  return useCallback(
    (file: File) => call(profileAvatarUploadForm(file)),
    [call],
  )
}
