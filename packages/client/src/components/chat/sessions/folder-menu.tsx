import { ContextMenu, DropdownMenu, RippleButton } from '@/components/ui'
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
} from 'lucide-react'

export type FolderMenuActions = {
  onCollapseAll: () => void
  onExpandAll: () => void
  edit: () => void
  remove: () => void
  reorder: (direction: -1 | 1) => void
  createChild: () => void
  move: () => void
  pin: () => void
}

type FolderMenuProps = FolderMenuActions & {
  pinned?: boolean
  pending: boolean
}

type FolderMenuItemsProps = FolderMenuProps & { dropdown?: boolean }

/** Shares folder actions between the context menu and the options button. */
function FolderMenuItems({
  dropdown,
  pending,
  pinned,
  ...actions
}: FolderMenuItemsProps) {
  const Item = dropdown ? DropdownMenu.Item : ContextMenu.Item
  const Separator = dropdown ? DropdownMenu.Separator : ContextMenu.Separator
  const select = (action: () => void) =>
    dropdown ? { onClick: action } : { onSelect: action }

  return (
    <>
      <Item disabled={pending} {...select(actions.pin)}>
        {pinned ? <PinOffIcon /> : <PinIcon />}
        {pinned ? 'Unpin' : 'Pin'}
      </Item>
      <Item disabled={pending} {...select(actions.createChild)}>
        Create subfolder…
      </Item>
      <Item disabled={pending} {...select(actions.edit)}>
        Edit folder…
      </Item>
      <Item disabled={pending} {...select(actions.move)}>
        Move folder…
      </Item>
      <Item disabled={pending} {...select(() => actions.reorder(-1))}>
        Move up
      </Item>
      <Item disabled={pending} {...select(() => actions.reorder(1))}>
        Move down
      </Item>
      <Separator />
      <Item {...select(actions.onCollapseAll)}>
        <ChevronsDownUpIcon />
        Collapse all
      </Item>
      <Item {...select(actions.onExpandAll)}>
        <ChevronsUpDownIcon />
        Expand all
      </Item>
      <Separator />
      <Item
        disabled={pending}
        variant="destructive"
        {...select(actions.remove)}
      >
        Delete folder…
      </Item>
    </>
  )
}

export function FolderContextMenu(props: FolderMenuProps) {
  return (
    <ContextMenu.Content>
      <FolderMenuItems {...props} />
    </ContextMenu.Content>
  )
}

export function FolderOptionsMenu({
  name,
  ...props
}: FolderMenuProps & { name: string }) {
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <RippleButton
            variant="stealth"
            size="icon"
            className="text-muted-foreground hover:text-foreground focus-visible:text-foreground size-7 shrink-0"
            aria-label={`Options for ${name}`}
            title="Folder options"
          >
            <MoreHorizontalIcon className="size-4" />
          </RippleButton>
        }
      />
      <DropdownMenu.Content align="end" className="w-48">
        <FolderMenuItems {...props} dropdown />
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
