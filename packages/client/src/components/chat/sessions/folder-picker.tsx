import { type IconName, IconSvg } from '@/components/icon-picker/icon-picker'
import { Combobox } from '@/components/ui/combobox'
import { RippleButton } from '@/components/ui/ripple-button'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { usePaginatedQuery, useQuery } from 'convex-helpers/react/cache/hooks'
import { FolderIcon, XIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

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
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selected = useQuery(
    api.sessionFolders.get,
    value ? { folderId: value as Id<'sessionFolders'> } : 'skip',
  )

  const pickerArgs = {
    organizationOnly,
    excludeBranchId: excludeBranchId as Id<'sessionFolders'> | undefined,
  }
  // Keep the first page subscribed independently of the popup's pagination
  const initialPage = usePaginatedQuery(
    api.sessionFolders.picker,
    { ...pickerArgs, search: '' },
    { initialNumItems: 20, customPagination: true },
  )
  const popupPage = usePaginatedQuery(
    api.sessionFolders.picker,
    open ? { ...pickerArgs, search } : 'skip',
    { initialNumItems: 20, customPagination: true },
  )
  const {
    results: available,
    status,
    loadMore,
  } = open ? popupPage : initialPage

  useEffect(() => {
    if (search && available.length < 20 && status === 'CanLoadMore')
      loadMore(20)
  }, [search, available.length, status, loadMore])

  const loadingSelection = Boolean(value) && selected === undefined
  const loading = loadingSelection || status === 'LoadingFirstPage'
  const controlsDisabled = disabled || loading

  return (
    <Combobox
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
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
          disabled={controlsDisabled}
          aria-busy={loading || undefined}
        >
          <FolderIconView icon={selected?.icon} />
          <Combobox.DisplayValue
            label={
              value
                ? ((showPath ? selected?.folderPath : selected?.name) ??
                  (loadingSelection ? label : 'Folder unavailable'))
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
            disabled={controlsDisabled}
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
        shouldFilter={false}
        side="top"
        className="w-[calc(min(fit-content,100%,200px))]"
      >
        <Combobox.Search
          placeholder="Search folders…"
          aria-label="Search folders"
          onValueChange={setSearch}
        />
        <Combobox.List className="max-h-52">
          {status === 'Exhausted' && (
            <Combobox.Empty>No folders found.</Combobox.Empty>
          )}
          <Combobox.Group>
            {rootLabel
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()) && (
              <Combobox.Item value="ungrouped" searchText={rootLabel}>
                {rootLabel}
              </Combobox.Item>
            )}
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
          {status !== 'Exhausted' && status !== 'LoadingFirstPage' && (
            <RippleButton
              variant="stealth"
              size="sm"
              className="w-full justify-start"
              disabled={status === 'LoadingMore'}
              onClick={() => loadMore(20)}
            >
              Load more folders
            </RippleButton>
          )}
        </Combobox.List>
      </Combobox.Content>
    </Combobox>
  )
}
