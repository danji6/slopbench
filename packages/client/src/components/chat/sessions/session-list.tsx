import { ConfirmDialog, Input, RippleButton } from '@/components/ui'
import { useDebouncedCallback } from '@/hooks'
import { useSession, useSessionGroups, useSessionSearch } from '@/hooks/chat'
import { type GroupRow, flattenSessionGroups } from '@/lib/chat/session-groups'
import { toastError } from '@/lib/notifications'
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { api } from '@sb/convex/_generated/api'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import { useAction, useMutation } from 'convex/react'
import { FolderPlusIcon } from 'lucide-react'
import { memo, useRef, useState } from 'react'
import { Virtualizer } from 'virtua'

import { useUnreadNotificationSessionIds } from '../notifications/notification-provider'
import { FolderDialog } from './folder-dialog'
import { FolderGroupRow } from './folder-group-row'
import { FolderHeader } from './folder-header'
import { SessionListMenu } from './session-list-menu'
import { SessionRow } from './session-row'
import { SessionTitleEditor } from './session-title-editor'

const SEARCH_DEBOUNCE = 250

export const SessionListView = memo(function SessionListView() {
  const { pages, folders, search, pendingSessionIds, dropSession } = useSessionGroups() // prettier-ignore
  const unreadSessionIds = useUnreadNotificationSessionIds()
  const setSearch = useSessionSearch()
  const commitSearch = useDebouncedCallback(setSearch, SEARCH_DEBOUNCE)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Doc<'sessionFolders'> | 'new' | null>(null) // prettier-ignore
  const [deleting, setDeleting] = useState<Doc<'sessionFolders'> | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed) // prettier-ignore
  const [dragTitle, setDragTitle] = useState<string | null>(null)
  const [frozenRows, setFrozenRows] = useState<GroupRow[] | null>(null)

  const change = useAction(api.actions.folders.change)
  const reorder = useMutation(api.sessionFolders.reorder)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }), // prettier-ignore
  )

  const keys = search.trim()
    ? ['search']
    : ['pinned', ...folders.map((f) => f._id), 'ungrouped']
  const rows = frozenRows ?? flattenSessionGroups(keys, pages, collapsed)

  function toggle(key: string) {
    const next = { ...collapsed, [key]: !collapsed[key] }
    setCollapsed(next)
    try {
      localStorage.setItem('session-folder-collapse', JSON.stringify(next))
    } catch {
      /* Storage may be unavailable. */
    }
  }

  async function order(from: number, to: number) {
    if (from < 0 || to < 0 || to >= folders.length || from === to) return
    const ids = folders.map((folder) => folder._id)
    const [id] = ids.splice(from, 1)
    ids.splice(to, 0, id!)
    await reorder({ folderIds: ids })
  }

  async function drop(event: DragEndEvent) {
    setFrozenRows(null)
    setDragTitle(null)
    const { active, over } = event
    if (!over) return

    try {
      if (active.data.current?.kind === 'folder') {
        await order(
          folders.findIndex((f) => f._id === active.id),
          folders.findIndex((f) => f._id === over.id),
        )
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
        last={rows[index + 1]?.key !== row.key}
        hasSources={Boolean(
          folders.find((folder) => folder._id === row.key)?.sources.length,
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
          edit={() => folder && setEditing(folder)}
          remove={() => folder && setDeleting(folder)}
          reorder={(direction) =>
            void order(
              folders.findIndex((f) => f._id === row.key),
              folders.findIndex((f) => f._id === row.key) + direction,
            ).catch(toastError)
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
            dropPending={pendingSessionIds.has(row.id)}
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
              : search
                ? 'No matching sessions'
                : 'No sessions'}
          </span>
        )}
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => {
        setFrozenRows(flattenSessionGroups(keys, pages, collapsed))
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
                onClick={() => setEditing('new')}
              >
                <FolderPlusIcon />
              </RippleButton>
              <SessionListMenu />
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
          <SortableContext items={keys} strategy={verticalListSortingStrategy}>
            <Virtualizer
              scrollRef={scrollRef as React.RefObject<HTMLElement>}
              data={rows}
            >
              {renderRow}
            </Virtualizer>
          </SortableContext>
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
            onClose={() => setEditing(null)}
          />
        )}
        <ConfirmDialog
          open={Boolean(deleting)}
          onOpenChange={(open) => !open && setDeleting(null)}
          title="Delete folder?"
          description="Sessions will move to Ungrouped and lose this folder’s source directories. Chats and pins will be kept."
          confirmText="Delete folder"
          variant="destructive"
          onConfirm={async () => {
            if (deleting) await change({ folderId: deleting._id, remove: true })
            setDeleting(null)
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
