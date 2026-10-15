import { ConfirmDialog, Input, RippleButton } from '@/components/ui'
import { useDebouncedCallback } from '@/hooks'
import { useSession, useSessionGroups, useSessionSearch } from '@/hooks/chat'
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
import { useAction, useMutation } from 'convex/react'
import { FolderPlusIcon } from 'lucide-react'
import { memo, useMemo, useState } from 'react'

import { useUnreadNotificationSessionIds } from '../notifications/notification-provider'
import { FolderDialog } from './folder-dialog'
import { FolderGroupRow } from './folder-group-row'
import { FolderHeader } from './folder-header'
import { FolderMoveDialog } from './folder-move-dialog'
import { SessionListMenu } from './session-list-menu'
import { SessionListRow } from './session-list-row'
import { SessionListScrollArea } from './session-list-scroll-area'
import type { SessionPageControls } from './session-page'
import { SessionTitleEditor } from './session-title-editor'
import { SessionTree } from './session-tree'
import { useFolderControls } from './use-folder-controls'

const SEARCH_DEBOUNCE = 250
// Keep sensor identity stable so folder toggles don't update every draggable.
const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } }

export const SessionListView = memo(function SessionListView() {
  const { pages, folders: serverFolders, search, pendingSessionIds, dropSession } = useSessionGroups() // prettier-ignore
  const unreadSessionIds = useUnreadNotificationSessionIds()
  const setSearch = useSessionSearch()
  const commitSearch = useDebouncedCallback(setSearch, SEARCH_DEBOUNCE)
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const {
    folders,
    collapsed,
    setCollapsed,
    headers,
    collapseAll,
    organizing,
    folderPins,
    pending: organizationPending,
    editing,
    setEditing,
    newParent,
    deleting,
    setDeleting,
    createFolder,
  } = useFolderControls(serverFolders)
  const [dragTitle, setDragTitle] = useState<string | null>(null)
  const [frozenRows, setFrozenRows] = useState<GroupRow[] | null>(null)

  const change = useAction(api.actions.folders.change)

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(KeyboardSensor),
  )

  const liveRows = useMemo(
    () =>
      search.trim()
        ? flattenSessionGroups(['search'], pages, {})
        : flattenSessionTree(folders, pages, {}),
    [search, pages, folders],
  )
  const rows = frozenRows ?? liveRows
  const foldersById = useMemo(
    () =>
      new Map<string, FolderView>(
        folders.map((folder) => [folder._id, folder]),
      ),
    [folders],
  )

  async function drop(event: DragEndEvent) {
    setFrozenRows(null)
    setDragTitle(null)
    const { active, over } = event
    if (!over || organizationPending) return

    try {
      if (active.data.current?.kind === 'folder') {
        const target = over.data.current
        if (target?.kind === 'folder-pin') {
          const pinned = await folderPins.setPinned(
            active.id as Id<'sessionFolders'>,
            true,
          )
          if (pinned) setCollapsed((current) => ({ ...current, pinned: false }))
          return
        }
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

  function renderRow(row: GroupRow, controls?: SessionPageControls) {
    if (row.kind === 'session') {
      return (
        <SessionListRow
          row={row}
          pending={organizationPending}
          dropPending={organizationPending || pendingSessionIds.has(row.id)}
          hasSources={Boolean(foldersById.get(row.key)?.workspace)}
          hasUnreadNotification={unreadSessionIds.has(row.id)}
          showFolder={Boolean(search.trim())}
          rename={setRenamingId}
        />
      )
    }
    const content = renderRowContent(row, controls)
    if (row.key === 'search') return content
    return (
      <FolderGroupRow
        row={row}
        last={Boolean(row.last)}
        pending={organizationPending}
        hasSources={Boolean(foldersById.get(row.key)?.workspace)}
      >
        {content}
      </FolderGroupRow>
    )
  }

  function renderRowContent(row: GroupRow, controls?: SessionPageControls) {
    const folder = foldersById.get(row.key)
    if (row.kind === 'separator') {
      return (
        <div className="px-1 py-3">
          <div
            className="border-t"
            role="separator"
            aria-label="Sessions without a folder"
          />
        </div>
      )
    }
    if (row.kind === 'header') {
      return (
        <FolderHeader
          groupKey={row.key}
          folder={folder}
          collapsed={Boolean(collapsed[row.key])}
          pending={organizationPending}
          {...headers.get(row.key)!}
        />
      )
    }

    const page = pages[row.key]
    if (!page || page.status === 'LoadingFirstPage') return null

    return (
      <div className="px-2 py-1 text-xs">
        {page.status === 'Exhausted' ? (
          <span className="text-muted-foreground">No matching sessions</span>
        ) : (
          <RippleButton
            variant="stealth"
            size="sm"
            className="text-muted-foreground hover:text-foreground justify-start text-xs font-normal no-underline"
            disabled={page.status === 'LoadingMore' || controls?.revealing}
            onClick={controls?.loadMore ?? (() => page.loadMore(20))}
          >
            Load more
          </RippleButton>
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
                disabled={organizationPending}
                onClick={createFolder}
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
        <SessionListScrollArea>
          <SessionTree
            rows={rows}
            collapsed={collapsed}
            renderRow={renderRow}
            search={search}
            pages={pages}
            dragging={Boolean(frozenRows)}
          />
        </SessionListScrollArea>
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
          description={`This folder and all its subfolders will be deleted. Sessions will move to ${folders.find((folder) => folder._id === deleting?.parentId)?.folderPath ?? 'no folder'}.${deleting?.parentId ? '' : ' Folder-provided filesystem access will be removed.'} Chats and session pins will be kept.`}
          confirmText="Delete folder"
          variant="destructive"
          onConfirm={async () => {
            try {
              if (deleting)
                await change({
                  command: { kind: 'delete-folder', folderId: deleting._id },
                })
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
