import {
  getSelectedSessionFolder,
  setSelectedSessionFolder,
} from '@/lib/ui-settings'
import { api } from '@sb/convex/_generated/api'
import { useQuery } from 'convex/react'
import { useEffect } from 'react'
import { useLocation, useSearch } from 'wouter'

import { useUserProfile } from './profile'
import { useActiveSession } from './session'

/** Remembers the current folder and opens its draft for the next session. */
export function useNewSession() {
  const [, navigate] = useLocation()
  const search = useSearch()
  const params = new URLSearchParams(search)
  const draftFolderId = params.has('id') ? null : params.get('folder')
  const session = useActiveSession()
  const userId = useUserProfile()?._id
  const folders = useQuery(api.sessionFolders.list)
  const sessionId = session?._id
  const ownerId = session?.ownerId
  const folderId = session?.folderId

  useEffect(() => {
    if (!userId) return
    if (sessionId && ownerId === userId) {
      setSelectedSessionFolder(userId, folderId ?? null)
    } else if (draftFolderId) {
      setSelectedSessionFolder(userId, draftFolderId)
    }
  }, [userId, sessionId, ownerId, folderId, draftFolderId])

  return () => {
    const selected = userId ? getSelectedSessionFolder(userId) : null
    const available =
      selected &&
      (folders === undefined ||
        folders.some((folder) => folder._id === selected))
    if (userId && !available) setSelectedSessionFolder(userId, null)
    navigate(available ? `/?folder=${selected}` : '/', { replace: true })
  }
}
