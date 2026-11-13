import { toastError } from '@/lib/notifications'
import { api } from '@cv/convex/_generated/api'
import type { Id } from '@cv/convex/_generated/dataModel'
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
        const pages = store.getAllQueries(api.sessionFolders.page)
        const folder = pages
          .flatMap(({ value }) => value?.page ?? [])
          .find((entry) => entry._id === folderId)
        if (!folder) return

        const updated = {
          ...folder,
          pinned: pinned || undefined,
          pinnedAt: pinned
            ? Math.max(
                0,
                ...pages.flatMap(
                  ({ value }) =>
                    value?.page.map((entry) => entry.pinnedAt ?? 0) ?? [],
                ),
              ) + 1
            : undefined,
        }

        const target = pinned ? 'pinned' : (folder.parentId ?? 'ungrouped')

        for (const { args, value } of pages) {
          if (!value) continue
          const page = value.page.filter((entry) => entry._id !== folderId)
          if (args.groupKey === target && args.paginationOpts.cursor === null) {
            page.push(updated)
            page.sort((a, b) =>
              pinned
                ? (a.pinnedAt ?? a._creationTime) -
                  (b.pinnedAt ?? b._creationTime)
                : a.position - b.position,
            )
          }
          store.setQuery(api.sessionFolders.page, args, {
            ...value,
            page: page.slice(0, args.paginationOpts.numItems),
          })
        }

        const selected = store.getQuery(api.sessionFolders.get, { folderId })

        if (selected)
          store.setQuery(api.sessionFolders.get, { folderId }, updated)
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
