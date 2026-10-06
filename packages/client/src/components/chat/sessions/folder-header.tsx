import { ContextMenu, RippleButton, useOptionalSidebar } from '@/components/ui'
import { useUserProfile } from '@/hooks/chat/profile'
import { setSelectedSessionFolder } from '@/lib/ui-settings'
import { cn } from '@/lib/utils'
import { useDraggable } from '@dnd-kit/core'
import type { FolderView } from '@sb/convex/types'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  PinIcon,
  PlusIcon,
} from 'lucide-react'
import { useLocation } from 'wouter'

import { FolderDropTargets } from './folder-drop-targets'
import { FolderIconView } from './folder-picker'

type FolderHeaderProps = {
  groupKey: string
  folder?: FolderView
  collapsed: boolean
  toggle: () => void
  onCollapseAll: () => void
  onExpandAll: () => void
  edit: () => void
  remove: () => void
  reorder: (direction: -1 | 1) => void
  createChild: () => void
  move: () => void
  pending: boolean
}

export function FolderHeader({
  groupKey,
  folder,
  collapsed,
  toggle,
  onCollapseAll,
  onExpandAll,
  edit,
  remove,
  reorder,
  createChild,
  move,
  pending,
}: FolderHeaderProps) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners } =
    useDraggable({
      id: groupKey,
      data: { kind: 'folder' },
      disabled: !folder || pending,
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
          className={cn('group/folder-header relative rounded-md')}
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
            title={folder?.folderPath}
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
          {folder && !pending && <FolderDropTargets folder={folder} />}
        </div>
      </ContextMenu.Trigger>
      {folder && (
        <ContextMenu.Content>
          <ContextMenu.Item disabled={pending} onSelect={createChild}>
            Create subfolder…
          </ContextMenu.Item>
          <ContextMenu.Item disabled={pending} onSelect={edit}>
            Edit folder…
          </ContextMenu.Item>
          <ContextMenu.Item disabled={pending} onSelect={move}>
            Move folder…
          </ContextMenu.Item>
          <ContextMenu.Item disabled={pending} onSelect={() => reorder(-1)}>
            Move up
          </ContextMenu.Item>
          <ContextMenu.Item disabled={pending} onSelect={() => reorder(1)}>
            Move down
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={onCollapseAll}>
            <ChevronsDownUpIcon className="mr-2 size-4" />
            Collapse all
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={onExpandAll}>
            <ChevronsUpDownIcon className="mr-2 size-4" />
            Expand all
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            disabled={pending}
            variant="destructive"
            onSelect={remove}
          >
            Delete folder…
          </ContextMenu.Item>
        </ContextMenu.Content>
      )}
    </ContextMenu>
  )
}
