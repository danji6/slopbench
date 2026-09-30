import type { SessionListItem } from '@/lib/chat'
import {
  type SessionDrop,
  createSessionDrop,
  projectSessionDrops,
  sessionDropConfirmed,
} from '@/lib/chat/session-drops'
import { api } from '@sb/convex/_generated/api'
import type { Doc } from '@sb/convex/_generated/dataModel'
import { useAction, useMutation } from 'convex/react'
import { useRef, useState } from 'react'

import type { SessionGroupPage } from './sessions'

/** Applies immediate sidebar moves with rollback and query reconciliation. */
export function useSessionDrops(
  pages: Record<string, SessionGroupPage>,
  folders: Doc<'sessionFolders'>[],
) {
  const [drops, setDrops] = useState<SessionDrop[]>([])
  const inFlight = useRef(new Set<string>())
  const change = useAction(api.actions.folders.change)
  const pin = useMutation(api.sessionFolders.pin)
  const pending = drops.filter((drop) => !sessionDropConfirmed(drop, pages))

  if (pending.length !== drops.length) setDrops(pending)

  async function dropSession(item: SessionListItem, target: string) {
    if (
      inFlight.current.has(item._id) ||
      pending.some((drop) => drop.item._id === item._id)
    ) {
      return
    }

    const folder = folders.find((folder) => folder._id === target)
    const drop = createSessionDrop(item, target, folder)
    if (!drop) return

    inFlight.current.add(item._id)
    setDrops((current) => [...current, drop])

    try {
      if (target === 'pinned') {
        await pin({ sessionId: item._id, pinned: true })
      } else {
        await change({
          sessionId: item._id,
          folderId: folder?._id,
          unpin: item.pinned || undefined,
        })
      }
      setDrops((current) =>
        current.map((drop) =>
          drop.item._id === item._id ? { ...drop, settled: true } : drop,
        ),
      )
    } catch (error) {
      setDrops((current) =>
        current.filter((drop) => drop.item._id !== item._id),
      )
      throw error
    } finally {
      inFlight.current.delete(item._id)
    }
  }

  return {
    pages: projectSessionDrops(pages, pending),
    pendingSessionIds: new Set(pending.map((drop) => drop.item._id)),
    dropSession,
  }
}
