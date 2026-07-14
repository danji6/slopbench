import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useMutation } from 'convex/react'
import { api } from '@sb/convex/_generated/api'
import type { ResolvedSettings } from '@sb/convex/model/defaults'

export function useSettings(): ResolvedSettings | undefined {
  return useQuery(api.settings.get, {})
}

// TODO debounce the actual db write
export function useSettingsUpdate() {
  return useMutation(api.settings.update).withOptimisticUpdate(
    (localStore, { patch }) => {
      const current = localStore.getQuery(api.settings.get, {})
      if (current !== undefined) {
        localStore.setQuery(
          api.settings.get,
          {},
          {
            ...current,
            ...(patch as Partial<ResolvedSettings>),
          },
        )
      }
    },
  )
}
