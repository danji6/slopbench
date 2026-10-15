import { toastError } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useMutation } from 'convex/react'
import { useCallback, useMemo, useRef, useState } from 'react'

/** Projects folder pins immediately and lets Convex reconcile or roll them back. */
export function useFolderPins() {
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const mutate = useMutation(api.sessionFolders.pinFolder)

  const pin = useMemo(
    () =>
      mutate.withOptimisticUpdate((store, { folderId, pinned }) => {
        const folders = store.getQuery(api.sessionFolders.list, {})
        if (!folders) return
        store.setQuery(
          api.sessionFolders.list,
          {},
          folders.map((folder) =>
            folder._id === folderId
              ? { ...folder, pinned: pinned || undefined }
              : folder,
          ),
        )
      }),
    [mutate],
  )

  const setPinned = useCallback(
    async (folderId: Id<'sessionFolders'>, pinned: boolean) => {
      if (inFlight.current) return false
      inFlight.current = true
      setPending(true)
      try {
        await pin({ folderId, pinned })
        return true
      } catch (err) {
        toastError(err, 'Could not pin folder')
        return false
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [pin],
  )

  return { pending, setPinned }
}
