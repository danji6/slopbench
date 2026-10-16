import {
  Accordion,
  ContextMenu,
  RippleButton,
  Tooltip,
  useOptionalSidebar,
} from '@/components/ui'
import { useUserProfile } from '@/hooks/chat/profile'
import { setSelectedSessionFolder } from '@/lib/ui-settings'
import { cn } from '@/lib/utils'
import { useDraggable } from '@dnd-kit/core'
import type { FolderView } from '@sb/convex/types'
import { PinIcon, SquarePenIcon } from 'lucide-react'
import { memo } from 'react'
import { useLocation } from 'wouter'

import { FolderDropTargets } from './folder-drop-targets'
import {
  FolderContextMenu,
  type FolderMenuActions,
  FolderOptionsMenu,
} from './folder-menu'
import { FolderIconView } from './folder-picker'

type FolderHeaderProps = FolderMenuActions & {
  groupKey: string
  folder?: FolderView
  collapsed: boolean
  toggle: () => void
  pending: boolean
}

export const FolderHeader = memo(function FolderHeader({
  groupKey,
  folder,
  collapsed,
  toggle,
  pending,
  ...actions
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
  const name = folder?.name ?? 'Pinned'

  function selectFolder() {
    if (userId && folder) setSelectedSessionFolder(userId, folder._id)
  }

  function compose() {
    if (!folder) return
    selectFolder()
    navigate(`/?folder=${folder._id}`, { replace: true })
    sidebar?.close()
  }

  const menu = { ...actions, pending, pinned: folder?.pinned }

  return (
    <ContextMenu disabled={!folder}>
      <ContextMenu.Trigger>
        <div
          ref={setNodeRef}
          className={cn(
            'relative grid items-center gap-x-0.5 rounded-md',
            folder ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
          )}
        >
          <RippleButton
            ref={setActivatorNodeRef}
            {...(folder ? attributes : {})}
            {...(folder ? listeners : {})}
            variant="stealth"
            className="col-span-full row-start-1 grid h-9 w-full min-w-0 grid-cols-subgrid rounded-md px-2 text-sm"
            onClick={() => {
              selectFolder()
              toggle()
            }}
            aria-expanded={!collapsed}
            title={folder?.folderPath}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Accordion.Icon
                isExpanded={!collapsed}
                className="size-3"
                aria-hidden
              />
              {folder ? (
                <FolderIconView icon={folder.icon} />
              ) : (
                <PinIcon className="size-4" />
              )}
              <span className="truncate">{name}</span>
            </span>
          </RippleButton>
          {folder && (
            <div className="relative z-10 col-start-2 row-start-1 flex items-center gap-0.5">
              <Tooltip>
                <Tooltip.Trigger
                  render={
                    <RippleButton
                      variant="stealth"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground focus-visible:text-foreground size-8 shrink-0"
                      aria-label={`Compose in ${name}`}
                      onClick={compose}
                    >
                      <SquarePenIcon />
                    </RippleButton>
                  }
                />
                <Tooltip.Content>Compose</Tooltip.Content>
              </Tooltip>
              <FolderOptionsMenu name={name} {...menu} />
            </div>
          )}
          {folder && !pending && <FolderDropTargets folder={folder} />}
        </div>
      </ContextMenu.Trigger>
      {folder && <FolderContextMenu {...menu} />}
    </ContextMenu>
  )
})
