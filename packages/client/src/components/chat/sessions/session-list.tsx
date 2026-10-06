import { ConfirmDialog, Input, RippleButton } from '@/components/ui'
import { useDebouncedCallback } from '@/hooks'
import { useSession, useSessionGroups, useSessionSearch } from '@/hooks/chat'
import { useFolderMoves } from '@/hooks/chat/folder-moves'
import {
  type FolderDropPlacement,
  folderDropIntent,
} from '@/lib/chat/folder-moves'
import {
  type GroupRow,
  flattenSessionGroups,
  flattenSessionTree,
} from '@/lib/chat/session-groups'
import { toastError } from '@/lib/notifications'
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { FolderView } from '@sb/convex/types'
import { folderBranch, folderSiblings } from '@sb/core/utils/folder-tree'
import { useAction, useMutation } from 'convex/react'
import { FolderPlusIcon } from 'lucide-react'
import { memo, useRef, useState } from 'react'
import { Virtualizer } from 'virtua'

import { useUnreadNotificationSessionIds } from '../notifications/notification-provider'
import { FolderDialog } from './folder-dialog'
import { FolderGroupRow } from './folder-group-row'
import { FolderHeader } from './folder-header'
import { FolderMoveDialog } from './folder-move-dialog'
import { SessionListMenu } from './session-list-menu'
import { SessionRow } from './session-row'
import { SessionTitleEditor } from './session-title-editor'

const SEARCH_DEBOUNCE = 250

export const SessionListView = memo(function SessionListView() {
  const { pages, folders: serverFolders, search, pendingSessionIds, dropSession } = useSessionGroups() // prettier-ignore
  const unreadSessionIds = useUnreadNotificationSessionIds()
  const setSearch = useSessionSearch()
  const commitSearch = useDebouncedCallback(setSearch, SEARCH_DEBOUNCE)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<FolderView | 'new' | null>(null) // prettier-ignore
  const [newParent, setNewParent] = useState<FolderView | undefined>(undefined)
  const [deleting, setDeleting] = useState<FolderView | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed) // prettier-ignore

  function updateCollapsed(next: Record<string, boolean>) {
    setCollapsed(next)
    saveCollapsed(next)
  }

  const organizing = useFolderMoves(serverFolders, (parentId) => {
    if (!parentId) return
    const parent = serverFolders.find((folder) => folder._id === parentId)
    const next = { ...collapsed }
    for (const id of [...(parent?.ancestorIds ?? []), parentId]) {
      next[id] = false
    }
    updateCollapsed(next)
  })
  const { folders } = organizing
  const [dragTitle, setDragTitle] = useState<string | null>(null)
  const [frozenRows, setFrozenRows] = useState<GroupRow[] | null>(null)

  const change = useAction(api.actions.folders.change)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const liveRows = search.trim()
    ? flattenSessionGroups(['search'], pages, collapsed)
    : flattenSessionTree(folders, pages, collapsed)
  const rows = frozenRows ?? liveRows

  function toggle(key: string) {
    updateCollapsed({ ...collapsed, [key]: !collapsed[key] })
  }

  function collapseAll(value: boolean, folder?: FolderView) {
    const keys = folder
      ? folderBranch(folders, folder._id).map((entry) => entry._id)
      : ['pinned', ...folders.map((entry) => entry._id), 'ungrouped']
    updateCollapsed({
      ...collapsed,
      ...Object.fromEntries(keys.map((key) => [key, value])),
    })
  }

  function order(folder: FolderView, direction: -1 | 1) {
    const siblings = folderSiblings(folders, folder.parentId)
    const index = siblings.findIndex((f) => f._id === folder._id)
    if (index + direction < 0 || index + direction >= siblings.length) return
    organizing.request({
      folderId: folder._id,
      parentId: folder.parentId ?? null,
      beforeFolderId:
        direction < 0 ? siblings[index - 1]?._id : siblings[index + 2]?._id,
    })
  }

  async function drop(event: DragEndEvent) {
    setFrozenRows(null)
    setDragTitle(null)
    const { active, over } = event
    if (!over) return

    try {
      if (active.data.current?.kind === 'folder') {
        const target = over.data.current
        if (target?.kind === 'folder-target') {
          const input = folderDropIntent(
            folders,
            String(active.id),
            target.folderId,
            target.placement as FolderDropPlacement,
          )
          if (input) organizing.request(input)
        }
        return
      }

      const sessionId = active.data.current?.sessionId as
        Id<'sessions'> | undefined
      if (!sessionId) return

      const item = Object.values(pages)
        .flatMap((page) => page.results)
        .find((session) => session._id === sessionId)
      if (item)
        await dropSession(item, String(over.data.current?.groupKey ?? over.id))
    } catch (err) {
      toastError(err, 'Could not organize session')
    }
  }

  function renderRow(row: GroupRow, index: number) {
    const content = renderRowContent(row)
    if (row.key === 'search') return content
    return (
      <FolderGroupRow
        row={row}
        last={row.last ?? rows[index + 1]?.key !== row.key}
        pending={organizing.pending}
        hasSources={Boolean(
          folders.find((folder) => folder._id === row.key)?.workspace,
        )}
      >
        {content}
      </FolderGroupRow>
    )
  }

  function renderRowContent(row: GroupRow) {
    const folder = folders.find((folder) => folder._id === row.key)
    if (row.kind === 'header') {
      return (
        <FolderHeader
          groupKey={row.key}
          folder={folder}
          collapsed={Boolean(collapsed[row.key])}
          toggle={() => toggle(row.key)}
          onCollapseAll={() => collapseAll(true, folder)}
          onExpandAll={() => collapseAll(false, folder)}
          edit={() => folder && setEditing(folder)}
          remove={() => folder && setDeleting(folder)}
          reorder={(direction) => folder && order(folder, direction)}
          pending={organizing.pending}
          createChild={() => {
            setNewParent(folder)
            setEditing('new')
          }}
          move={() =>
            folder &&
            organizing.request(
              { folderId: folder._id, parentId: folder.parentId ?? null },
              true,
            )
          }
        />
      )
    }

    if (row.kind === 'session') {
      return (
        <div className="py-0.5">
          <SessionRow
            showFolder={Boolean(search.trim())}
            id={row.id}
            dropPending={organizing.pending || pendingSessionIds.has(row.id)}
            hasUnreadNotification={unreadSessionIds.has(row.id)}
            rename={setRenamingId}
          />
        </div>
      )
    }

    const page = pages[row.key]
    return (
      <div className="px-2 py-2 text-center text-xs">
        {page?.status === 'CanLoadMore' ? (
          <RippleButton
            variant="stealth"
            size="sm"
            onClick={() => page.loadMore(20)}
          >
            Load more
          </RippleButton>
        ) : (
          <span className="text-muted-foreground">
            {!page || page.status.startsWith('Loading')
              ? 'Loading…'
              : 'No matching sessions'}
          </span>
        )}
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) =>
        args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)
      }
      onDragStart={({ active }) => {
        setFrozenRows(liveRows)
        const session = Object.values(pages)
          .flatMap((page) => page.results)
          .find((item) => item._id === active.data.current?.sessionId)
        setDragTitle(
          session?.title ||
            session?.firstMessagePreview ||
            folders.find((folder) => folder._id === active.id)?.name ||
            'New chat',
        )
      }}
      onDragCancel={() => {
        setFrozenRows(null)
        setDragTitle(null)
      }}
      onDragEnd={(event) => void drop(event)}
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        <header className="flex flex-col gap-2 px-3">
          <div className="flex items-center justify-between gap-2">
            <span className="ml-2 font-bold">Sessions</span>
            <div className="flex items-center">
              <RippleButton
                variant="stealth"
                size="icon"
                aria-label="Create folder"
                disabled={organizing.pending}
                onClick={() => {
                  setNewParent(undefined)
                  setEditing('new')
                }}
              >
                <FolderPlusIcon />
              </RippleButton>
              <SessionListMenu
                onCollapseAll={() => collapseAll(true)}
                onExpandAll={() => collapseAll(false)}
              />
            </div>
          </div>
          <Input
            placeholder="Search…"
            aria-label="Search sessions"
            value={query}
            onValueChange={(value) => {
              setQuery(value)
              commitSearch.run(value)
            }}
            className="border-input/50 h-10"
          />
        </header>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2">
          <Virtualizer
            scrollRef={scrollRef as React.RefObject<HTMLElement>}
            data={rows}
          >
            {renderRow}
          </Virtualizer>
        </div>
        {renamingId && (
          <SessionRenameDialog
            id={renamingId}
            onClose={() => setRenamingId(null)}
          />
        )}
        {editing && (
          <FolderDialog
            key={editing === 'new' ? 'new' : editing._id}
            folder={editing === 'new' ? undefined : editing}
            parent={editing === 'new' ? newParent : undefined}
            onClose={() => setEditing(null)}
          />
        )}
        {organizing.intent &&
          folders.find(
            (folder) => folder._id === organizing.intent?.folderId,
          ) && (
            <FolderMoveDialog
              key={organizing.intent.folderId}
              folder={folders.find(
                (folder) => folder._id === organizing.intent?.folderId,
              )!}
              intent={organizing.intent}
              chooseParent={organizing.chooseParent}
              onMove={organizing.apply}
              onClose={organizing.cancel}
            />
          )}
        <ConfirmDialog
          open={Boolean(deleting)}
          onOpenChange={(open) => !open && setDeleting(null)}
          title="Delete folder?"
          description={`This folder and all its subfolders will be deleted. Sessions will move to ${folders.find((folder) => folder._id === deleting?.parentId)?.folderPath ?? 'Ungrouped'}.${deleting?.parentId ? '' : ' Folder-provided filesystem access will be removed.'} Chats and pins will be kept.`}
          confirmText="Delete folder"
          variant="destructive"
          onConfirm={async () => {
            try {
              if (deleting)
                await change({ folderId: deleting._id, remove: true })
              setDeleting(null)
            } catch (err) {
              toastError(err, 'Could not delete folder')
            }
          }}
        />
      </div>
      <DragOverlay dropAnimation={null}>
        {dragTitle && (
          <div className="bg-popover max-w-64 truncate rounded-md border px-3 py-2 text-sm shadow-lg">
            {dragTitle}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
})

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem('session-folder-collapse') ?? '{}')
  } catch {
    return {}
  }
}

function saveCollapsed(value: Record<string, boolean>) {
  try {
    localStorage.setItem('session-folder-collapse', JSON.stringify(value))
  } catch {
    /* Storage may be unavailable. */
  }
}

function SessionRenameDialog({
  id,
  onClose,
}: {
  id: string
  onClose: () => void
}) {
  const session = useSession(id)
  const updateSession = useMutation(api.sessions.update)
  const regenerateTitle = useAction(api.actions.sessions.regenerateTitle)

  return (
    <SessionTitleEditor
      show
      initialValue={session?.title}
      onClose={onClose}
      onConfirm={async (title) => {
        await updateSession({ sessionId: id as Id<'sessions'>, title })
        onClose()
      }}
      onRegenerate={() => regenerateTitle({ sessionId: id as Id<'sessions'> })}
    />
  )
}
