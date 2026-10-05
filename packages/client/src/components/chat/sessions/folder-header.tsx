import { ContextMenu, RippleButton, useOptionalSidebar } from '@/components/ui'
import { useUserProfile } from '@/hooks/chat/profile'
import { setSelectedSessionFolder } from '@/lib/ui-settings'
import { cn } from '@/lib/utils'
import { useDndContext } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import type { Doc } from '@sb/convex/_generated/dataModel'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PinIcon,
  PlusIcon,
} from 'lucide-react'
import { useLocation } from 'wouter'

import { FolderIconView } from './folder-picker'

type FolderHeaderProps = {
  groupKey: string
  folder?: Doc<'sessionFolders'>
  collapsed: boolean
  toggle: () => void
  edit: () => void
  remove: () => void
  reorder: (direction: -1 | 1) => void
}

export function FolderHeader({
  groupKey,
  folder,
  collapsed,
  toggle,
  edit,
  remove,
  reorder,
}: FolderHeaderProps) {
  const { active } = useDndContext()
  const draggingFolder = active?.data.current?.kind === 'folder'
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isOver } =
    useSortable({
      id: groupKey,
      data: { kind: 'folder' },
      disabled: {
        draggable: !folder,
        droppable: !draggingFolder || !folder,
      },
    })

  const [, navigate] = useLocation()
  const sidebar = useOptionalSidebar()
  const userId = useUserProfile()?._id

  const selectFolder = () => {
    if (userId && (folder || groupKey === 'ungrouped'))
      setSelectedSessionFolder(userId, folder?._id ?? null)
  }

  const name = folder?.name ?? (groupKey === 'pinned' ? 'Pinned' : 'Ungrouped')
  const canCreateSession = Boolean(folder) || groupKey === 'ungrouped'

  return (
    <ContextMenu>
      <ContextMenu.Trigger>
        <div
          ref={setNodeRef}
          className={cn(
            'group/folder-header relative rounded-md',
            isOver && 'bg-primary/15 ring-primary ring-1',
          )}
        >
          <RippleButton
            ref={setActivatorNodeRef}
            {...(folder ? attributes : {})}
            {...(folder ? listeners : {})}
            variant="stealth"
            className={cn(
              'group-hover/folder-header:bg-m3-surface-container-high h-9 w-full min-w-0 justify-start gap-1.5 rounded-md px-1 text-sm has-[>svg]:px-1',
              canCreateSession && 'pr-10 has-[>svg]:pr-10',
            )}
            onClick={() => {
              selectFolder()
              toggle()
            }}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronRightIcon className="size-3" />
            ) : (
              <ChevronDownIcon className="size-3" />
            )}
            {groupKey === 'pinned' ? (
              <PinIcon className="size-4" />
            ) : (
              <FolderIconView icon={folder?.icon} />
            )}
            <span className="truncate">{name}</span>
          </RippleButton>
          {canCreateSession && (
            <RippleButton
              variant="stealth"
              size="icon"
              className="absolute top-1 right-1 size-7"
              aria-label={`New session in ${name}`}
              onClick={() => {
                selectFolder()
                navigate(folder ? `/?folder=${folder._id}` : '/', {
                  replace: true,
                })
                sidebar?.close()
              }}
            >
              <PlusIcon className="size-4" />
            </RippleButton>
          )}
        </div>
      </ContextMenu.Trigger>
      {folder && (
        <ContextMenu.Content>
          <ContextMenu.Item onSelect={edit}>Edit folder…</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => reorder(-1)}>
            Move up
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => reorder(1)}>
            Move down
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={remove}>
            Delete folder…
          </ContextMenu.Item>
        </ContextMenu.Content>
      )}
    </ContextMenu>
  )
}
