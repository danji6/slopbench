import {
  folderMoveConfirmed,
  folderMoveNeedsConfirmation,
  projectLoadedFolderMove,
} from '@/lib/chat/folder-moves'
import { toastError } from '@/lib/notifications'
import { api } from '@cv/convex/_generated/api'
import type { FolderMoveArgs, FolderView } from '@cv/convex/types'
import { useAction, useQuery } from 'convex/react'
import { useCallback, useMemo, useRef, useState } from 'react'

type PendingMove = {
  input: FolderMoveArgs
  settled: boolean
  revision?: number
}

/** Projects topology immediately while retaining committed workspace contexts. */
export function useFolderMoves(
  serverFolders: FolderView[],
  expand: (parentId: string | null) => void,
) {
  const move = useAction(api.actions.folders.move)
  const inFlight = useRef(false)
  const [pending, setPending] = useState<PendingMove | null>(null)
  const [intent, setIntent] = useState<FolderMoveArgs | null>(null)
  const [chooseParent, setChooseParent] = useState(false)

  const authoritative = useQuery(
    api.sessionFolders.get,
    pending ? { folderId: pending.input.folderId } : 'skip',
  )

  const committed =
    pending &&
    (authoritative === null ||
      folderMoveConfirmed(
        authoritative ? [authoritative] : serverFolders,
        pending.input,
        pending.revision,
      ))

  const loaded = serverFolders.find(
    (folder) => folder._id === pending?.input.folderId,
  )

  const visibleRevisionCurrent =
    !loaded ||
    pending?.revision === undefined ||
    (loaded.organizationRevision ?? 0) >= pending.revision

  const confirmed = pending?.settled && committed && visibleRevisionCurrent
  if (confirmed) setPending(null)

  const activeMove = confirmed ? null : pending
  const folders = useMemo(
    () =>
      activeMove
        ? projectLoadedFolderMove(serverFolders, activeMove.input)
        : serverFolders,
    [serverFolders, activeMove],
  )

  const apply = useCallback(
    async (input: FolderMoveArgs) => {
      if (inFlight.current || (pending && !confirmed)) return
      inFlight.current = true
      setIntent(null)
      setPending({ input, settled: false })
      expand(input.parentId)
      try {
        const revision = await move(input)
        setPending({
          input,
          settled: true,
          revision: typeof revision === 'number' ? revision : undefined,
        })
      } catch (err) {
        setPending(null)
        toastError(err, 'Could not move folder')
      } finally {
        inFlight.current = false
      }
    },
    [pending, confirmed, expand, move],
  )

  const request = useCallback(
    (input: FolderMoveArgs, picker = false) => {
      if (inFlight.current || (pending && !confirmed)) return
      if (picker || folderMoveNeedsConfirmation(serverFolders, input)) {
        setChooseParent(picker)
        setIntent(input)
      } else void apply(input)
    },
    [pending, confirmed, serverFolders, apply],
  )

  const cancel = useCallback(() => setIntent(null), [])

  return {
    folders,
    pending: Boolean(pending && !confirmed),
    intent,
    chooseParent,
    request,
    apply,
    cancel,
  }
}
