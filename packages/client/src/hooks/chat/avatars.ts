import { normalizeBrowserUrl } from '@/lib/auth/site-url'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'

import { createMediaUrlStore } from './media-urls'

export type AvatarUrls = { original: string | null; thumbnail: string | null }

const store = createMediaUrlStore(api.avatars.getUrlMap)

/** Resolves every requested avatar in one query. */
export const AvatarUrlProvider = store.Provider

/** Eagerly adds avatars to the shared subscription before they render. */
export const registerAvatarIds = store.register

/** Resolves a single avatar's normalized URLs from the shared cache. */
export function useAvatarUrls(avatarId?: Id<'avatars'>): AvatarUrls {
  const urls = store.useMediaUrl(avatarId)
  return {
    original: normalizeBrowserUrl(urls?.original ?? null),
    thumbnail: normalizeBrowserUrl(urls?.thumbnail ?? null),
  }
}

export function useAvatarThumbnail(avatarId?: Id<'avatars'>): string | null {
  const { thumbnail, original } = useAvatarUrls(avatarId)
  return thumbnail ?? original
}
