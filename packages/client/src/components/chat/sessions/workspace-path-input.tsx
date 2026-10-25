import { Input } from '@/components/ui/input'
import {
  getRecentDirectories,
  subscribeRecentDirectories,
} from '@/lib/chat/recent-directory-store'
import { cn } from '@/lib/utils'
import { useThemeScope } from '@/providers/theme-scope'
import { Autocomplete } from '@base-ui/react/autocomplete'
import Fuse from 'fuse.js'
import { HistoryIcon } from 'lucide-react'
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'

type WorkspacePathInputProps = {
  value: string
  onChange: (value: string) => void
  onNavigate: (path: string) => void
  errorId?: string
}

export function WorkspacePathInput({
  value,
  onChange,
  onNavigate,
  errorId,
}: WorkspacePathInputProps) {
  const recent = useSyncExternalStore(
    subscribeRecentDirectories,
    getRecentDirectories,
  )
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const highlighted = useRef<string | undefined>(undefined)
  const themeScope = useThemeScope()
  const fuse = useMemo(
    () => new Fuse(recent, { threshold: 0.4, ignoreLocation: true }),
    [recent],
  )
  const matches = search.trim()
    ? fuse.search(search.trim()).map(({ item }) => item)
    : recent

  function navigate(path: string) {
    setOpen(false)
    setSearch('')
    onNavigate(path)
  }

  return (
    <Autocomplete.Root
      items={recent}
      filteredItems={matches}
      filter={null}
      value={value}
      onValueChange={(next, details) => {
        onChange(next)
        if (details.reason === 'input-change') setSearch(next)
      }}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
      onItemHighlighted={(item) => {
        highlighted.current = item
      }}
      openOnInputClick
    >
      <Autocomplete.Input
        render={<Input size="sm" />}
        aria-label="Folder path"
        aria-invalid={!!errorId}
        aria-describedby={errorId}
        placeholder="/path/to/project"
        className="min-w-0 flex-1 font-mono text-xs"
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          if (open && highlighted.current !== undefined) return
          event.preventDefault()
          if (value.trim()) navigate(value.trim())
        }}
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          align="start"
          sideOffset={4}
          className={cn('z-55', themeScope)}
        >
          <Autocomplete.Popup className="bg-popover text-popover-foreground ring-foreground/10 popup-motion w-(--anchor-width) max-w-[calc(100dvw-2rem)] min-w-40 overflow-hidden rounded-lg p-1 shadow-md ring-1 outline-none">
            <p className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
              Recent folders
            </p>
            <Autocomplete.Empty className="text-muted-foreground px-2 py-2 text-xs">
              {recent.length
                ? 'No matching recent folders.'
                : 'No recent folders yet.'}
            </Autocomplete.Empty>
            <Autocomplete.List
              aria-label="Recent folders"
              className="max-h-52 overflow-y-auto"
            >
              {(path: string) => (
                <Autocomplete.Item
                  key={path}
                  value={path}
                  title={path}
                  onClick={() => navigate(path)}
                  className="data-highlighted:bg-m3-surface-container-high flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs outline-none"
                >
                  <HistoryIcon className="size-3.5 shrink-0" />
                  <span className="truncate font-mono">{path}</span>
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  )
}
