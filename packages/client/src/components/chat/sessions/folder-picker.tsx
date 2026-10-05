import { type IconName, IconSvg } from '@/components/icon-picker/icon-picker'
import { Combobox } from '@/components/ui/combobox'
import { api } from '@sb/convex/_generated/api'
import { useQuery } from 'convex/react'
import { FolderIcon } from 'lucide-react'

export function FolderIconView({ icon }: { icon?: string }) {
  return icon ? (
    <IconSvg name={icon as IconName} className="size-4 shrink-0" />
  ) : (
    <FolderIcon className="size-4 shrink-0" />
  )
}

export function FolderPicker({
  value,
  onChange,
  disabled,
  organizationOnly = false,
}: {
  value?: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  organizationOnly?: boolean
}) {
  const folders = useQuery(api.sessionFolders.list) ?? []
  const selected = folders.find((folder) => folder._id === value)
  const available = organizationOnly
    ? folders.filter((folder) => !folder.sources.length)
    : folders
  return (
    <Combobox
      value={value ?? 'ungrouped'}
      onValueChange={(next) => onChange(next === 'ungrouped' ? null : next)}
      noDeselect
    >
      <Combobox.Trigger
        aria-label="Session folder"
        variant="input"
        className="max-w-64"
        size="sm"
        disabled={disabled}
      >
        <FolderIconView icon={selected?.icon} />
        <Combobox.DisplayValue
          label={value ? (selected?.name ?? 'Folder unavailable') : 'Ungrouped'}
        />
      </Combobox.Trigger>
      <Combobox.Content side="top">
        <Combobox.Search
          placeholder="Search folders…"
          aria-label="Search folders"
        />
        <Combobox.List className="max-h-52">
          <Combobox.Empty>No folders found.</Combobox.Empty>
          <Combobox.Group>
            <Combobox.Item value="ungrouped" searchText="Ungrouped">
              Ungrouped
            </Combobox.Item>
            {available.map((folder) => (
              <Combobox.Item
                key={folder._id}
                value={folder._id}
                searchText={folder.name}
              >
                <span className="flex items-center gap-2">
                  <FolderIconView icon={folder.icon} />
                  <span className="truncate">{folder.name}</span>
                </span>
              </Combobox.Item>
            ))}
          </Combobox.Group>
        </Combobox.List>
      </Combobox.Content>
    </Combobox>
  )
}
