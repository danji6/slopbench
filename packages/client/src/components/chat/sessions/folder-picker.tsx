import { type IconName, IconSvg } from '@/components/icon-picker/icon-picker'
import { Select } from '@/components/ui/select'
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
}: {
  value?: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
}) {
  const folders = useQuery(api.sessionFolders.list) ?? []
  return (
    <Select
      value={value ?? ''}
      onValueChange={(next) => onChange(next || null)}
      disabled={disabled}
    >
      <Select.Trigger
        aria-label="Session folder"
        variant="input"
        className="max-w-64"
        size="sm"
      >
        <FolderIconView
          icon={folders.find((folder) => folder._id === value)?.icon}
        />
        <Select.Value>
          {value
            ? (folders.find((folder) => folder._id === value)?.name ??
              'Folder unavailable')
            : 'Ungrouped'}
        </Select.Value>
      </Select.Trigger>
      <Select.Content side="top">
        <Select.Item value="">Ungrouped</Select.Item>
        {folders.map((folder) => (
          <Select.Item key={folder._id} value={folder._id}>
            <FolderIconView icon={folder.icon} />
            {folder.name}
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  )
}
