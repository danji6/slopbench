import {
  type UpdateCheck,
  getUpdateCheck,
  isUpdateCheckStale,
  setUpdateCheck,
  subscribeToUpdateCheck,
} from '@/lib/chat/update-store'
import { api } from '@sb/convex/_generated/api'
import { useAction } from 'convex/react'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { useIsAdmin } from './tools'

/** Used to inform the host when a newer release is available. Admin only. */
export function useUpdateCheck(): UpdateCheck & { available: boolean } {
  const isAdmin = useIsAdmin()
  const check = useSyncExternalStore(subscribeToUpdateCheck, getUpdateCheck)
  const checkForUpdate = useAction(api.actions.update.checkForUpdate)
  const requested = useRef(false)

  useEffect(() => {
    if (!isAdmin || requested.current || !isUpdateCheckStale(check)) return
    requested.current = true

    void checkForUpdate({})
      .then((status) =>
        setUpdateCheck({
          available: status.available,
          current: status.current,
          latest: status.latest,
          notes: status.notes,
          publishedAt: status.publishedAt,
          url: status.url,
        }),
      )
      .catch(() => setUpdateCheck({ available: false }))
  }, [check, checkForUpdate, isAdmin])

  return { ...check, available: isAdmin && check.available === true }
}
