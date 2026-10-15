import {
  Accordion,
  ContextMenu,
  RippleButton,
  Tooltip,
  useOptionalSidebar,
} from '@/components/ui'
import { useUserProfile } from '@/hooks/chat/profile'
import { setSelectedSessionFolder } from '@/lib/ui-settings'
import { useDraggable } from '@dnd-kit/core'
import type { FolderView } from '@sb/convex/types'
import { PinIcon, SquarePenIcon } from 'lucide-react'
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

export function FolderHeader({
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
          className="relative flex items-center gap-0.5 rounded-md"
        >
          <RippleButton
            ref={setActivatorNodeRef}
            {...(folder ? attributes : {})}
            {...(folder ? listeners : {})}
            variant="stealth"
            className="h-9 min-w-0 flex-1 justify-start gap-1.5 rounded-md px-1 text-sm has-[>svg]:px-1"
            onClick={() => {
              selectFolder()
              toggle()
            }}
            aria-expanded={!collapsed}
            title={folder?.folderPath}
          >
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
          </RippleButton>
          {folder && (
            <>
              <Tooltip>
                <Tooltip.Trigger
                  render={
                    <RippleButton
                      variant="stealth"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground focus-visible:text-foreground size-7 shrink-0"
                      aria-label={`Compose in ${name}`}
                      onClick={compose}
                    >
                      <SquarePenIcon className="size-4" />
                    </RippleButton>
                  }
                />
                <Tooltip.Content>Compose</Tooltip.Content>
              </Tooltip>
              <FolderOptionsMenu name={name} {...menu} />
            </>
          )}
          {folder && !pending && <FolderDropTargets folder={folder} />}
        </div>
      </ContextMenu.Trigger>
      {folder && <FolderContextMenu {...menu} />}
    </ContextMenu>
  )
}
