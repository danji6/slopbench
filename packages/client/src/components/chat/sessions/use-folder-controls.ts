import { useFolderMoves } from '@/hooks/chat/folder-moves'
import { useFolderPins } from '@/hooks/chat/folder-pins'
import { readCollapsed, saveCollapsed } from '@/lib/chat/session-folder-state'
import type { FolderView } from '@sb/convex/types'
import { folderBranch, folderSiblings } from '@sb/core/utils/folder-tree'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { FolderMenuActions } from './folder-menu'

type FolderHeaderActions = FolderMenuActions & { toggle: () => void }

/** Keeps folder controls stable while session pages and expansion state change. */
export function useFolderControls(serverFolders: FolderView[]) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed) // prettier-ignore
  const [editing, setEditing] = useState<FolderView | 'new' | null>(null)
  const [newParent, setNewParent] = useState<FolderView | undefined>(undefined)
  const [deleting, setDeleting] = useState<FolderView | null>(null)

  useEffect(() => saveCollapsed(collapsed), [collapsed])

  const expandParent = useCallback(
    (parentId: string | null) => {
      if (!parentId) return
      const parent = serverFolders.find((folder) => folder._id === parentId)
      setCollapsed((current) => {
        const next = { ...current }
        for (const id of [...(parent?.ancestorIds ?? []), parentId]) {
          next[id] = false
        }
        return next
      })
    },
    [serverFolders],
  )

  const organizing = useFolderMoves(serverFolders, expandParent)
  const folderPins = useFolderPins()
  const { folders, request } = organizing
  const { setPinned } = folderPins

  const toggle = useCallback((key: string) => {
    setCollapsed((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const collapseAll = useCallback(
    (value: boolean, folder?: FolderView) => {
      const keys = folder
        ? folderBranch(folders, folder._id).map((entry) => entry._id)
        : ['pinned', ...folders.map((entry) => entry._id)]
      setCollapsed((current) => ({
        ...current,
        ...Object.fromEntries(keys.map((key) => [key, value])),
      }))
    },
    [folders],
  )

  const order = useCallback(
    (folder: FolderView, direction: -1 | 1) => {
      const siblings = folderSiblings(folders, folder.parentId)
      const index = siblings.findIndex((entry) => entry._id === folder._id)
      if (index + direction < 0 || index + direction >= siblings.length) return
      request({
        folderId: folder._id,
        parentId: folder.parentId ?? null,
        beforeFolderId:
          direction < 0 ? siblings[index - 1]?._id : siblings[index + 2]?._id,
      })
    },
    [folders, request],
  )

  const headers = useMemo(() => {
    const actions = new Map<string, FolderHeaderActions>()
    for (const folder of [undefined, ...folders]) {
      const key = folder?._id ?? 'pinned'
      actions.set(key, {
        toggle: () => toggle(key),
        onCollapseAll: () => collapseAll(true, folder),
        onExpandAll: () => collapseAll(false, folder),
        edit: () => folder && setEditing(folder),
        remove: () => folder && setDeleting(folder),
        reorder: (direction) => folder && order(folder, direction),
        pin: () => {
          if (folder) void setPinned(folder._id, !folder.pinned)
        },
        createChild: () => {
          setNewParent(folder)
          setEditing('new')
        },
        move: () => {
          if (!folder) return
          request(
            { folderId: folder._id, parentId: folder.parentId ?? null },
            true,
          )
        },
      })
    }
    return actions
  }, [folders, toggle, collapseAll, order, request, setPinned])

  function createFolder() {
    setNewParent(undefined)
    setEditing('new')
  }

  return {
    folders,
    collapsed,
    setCollapsed,
    headers,
    collapseAll,
    organizing,
    folderPins,
    pending: organizing.pending || folderPins.pending,
    editing,
    setEditing,
    newParent,
    deleting,
    setDeleting,
    createFolder,
  }
}
