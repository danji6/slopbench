import { normalizeBrowserUrl } from '@/lib/auth/site-url'
import { useEffect, useMemo } from 'react'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'

import { createMediaUrlStore } from './media-urls'

const store = createMediaUrlStore(api.attachments.getUrlMap)

/** Resolves every requested attachment in one query. */
export const AttachmentUrlProvider = store.Provider

export type AttachmentUrls = {
  url: string | null
  previewUrl: string | null
}

/** Resolves many attachments to their normalized URLs from the shared cache. */
export function useAttachmentUrls(
  ids: Id<'attachments'>[],
): Record<string, AttachmentUrls> {
  useEffect(() => store.register(ids), [ids])

  const map = store.useMediaUrls()

  return useMemo(() => {
    const out: Record<string, AttachmentUrls> = {}

    for (const id of ids) {
      const entry = map[id]
      out[id] = {
        url: normalizeBrowserUrl(entry?.url ?? null),
        previewUrl: normalizeBrowserUrl(
          entry?.previewUrl ?? entry?.url ?? null,
        ),
      }
    }

    return out
  }, [ids, map])
}
