import { type IconName, IconSvg } from '@/components/icon-picker/icon-picker'
import { Combobox } from '@/components/ui/combobox'
import { RippleButton } from '@/components/ui/ripple-button'
import { api } from '@sb/convex/_generated/api'
import { orderedFolderTree } from '@sb/core/utils/folder-tree'
import { useQuery } from 'convex/react'
import { FolderIcon, XIcon } from 'lucide-react'
import { useRef } from 'react'

export function FolderIconView({ icon }: { icon?: string }) {
  return icon ? (
    <IconSvg name={icon as IconName} className="size-4 shrink-0" />
  ) : (
    <FolderIcon className="size-4 shrink-0" />
  )
}

type FolderPickerProps = {
  value?: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  organizationOnly?: boolean
  rootLabel?: string
  label?: string
  excludeBranchId?: string
  showPath?: boolean
}

export function FolderPicker({
  value,
  onChange,
  disabled,
  organizationOnly = false,
  rootLabel = 'No folder',
  label = 'Session folder',
  excludeBranchId,
  showPath = true,
}: FolderPickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const folders = useQuery(api.sessionFolders.list) ?? []
  const selected = folders.find((folder) => folder._id === value)
  const available = orderedFolderTree(folders)
    .map(({ folder }) => folder)
    .filter(
      (folder) =>
        (!organizationOnly || !folder.workspace) &&
        folder._id !== excludeBranchId &&
        !folder.ancestorIds.includes(excludeBranchId ?? ''),
    )

  return (
    <Combobox
      value={value ?? 'ungrouped'}
      onValueChange={(next) =>
        onChange(!next || next === 'ungrouped' ? null : next)
      }
    >
      <div className="flex max-w-xs min-w-0 items-center gap-1.5">
        <Combobox.Trigger
          ref={triggerRef}
          aria-label={label}
          title={selected?.folderPath ?? rootLabel}
          variant="input"
          className="min-w-0 flex-1"
          disabled={disabled}
        >
          <FolderIconView icon={selected?.icon} />
          <Combobox.DisplayValue
            label={
              value
                ? ((showPath ? selected?.folderPath : selected?.name) ??
                  'Folder unavailable')
                : rootLabel
            }
          />
        </Combobox.Trigger>
        {value && (
          <RippleButton
            variant="stealth"
            size="icon"
            className="text-muted-foreground size-8 shrink-0"
            aria-label={`Clear ${label.toLowerCase()}`}
            title="Clear folder"
            disabled={disabled}
            onClick={() => {
              onChange(null)
              triggerRef.current?.focus()
            }}
          >
            <XIcon />
          </RippleButton>
        )}
      </div>
      <Combobox.Content
        side="top"
        className="w-[calc(min(fit-content,100%,200px))]"
      >
        <Combobox.Search
          placeholder="Search folders…"
          aria-label="Search folders"
        />
        <Combobox.List className="max-h-52">
          <Combobox.Empty>No folders found.</Combobox.Empty>
          <Combobox.Group>
            <Combobox.Item value="ungrouped" searchText={rootLabel}>
              {rootLabel}
            </Combobox.Item>
            {available.map((folder) => (
              <Combobox.Item
                key={folder._id}
                value={folder._id}
                searchText={folder.folderPath}
              >
                <span className="flex items-center gap-2">
                  <FolderIconView icon={folder.icon} />
                  <span className="truncate" title={folder.folderPath}>
                    {folder.folderPath}
                  </span>
                </span>
              </Combobox.Item>
            ))}
          </Combobox.Group>
        </Combobox.List>
      </Combobox.Content>
    </Combobox>
  )
}
