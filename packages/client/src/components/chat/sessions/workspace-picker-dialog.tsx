import { Dialog, Input, RippleButton } from '@/components/ui'
import { useWorkspaceBrowser } from '@/hooks/chat'
import { cn } from '@/lib/utils'
import { ArrowRightIcon, CornerLeftUpIcon, FolderIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

interface WorkspacePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (root: string) => void
  initialPath?: string
  title?: string
}

type Row = { name: string; target?: string; isParent?: boolean }

export function WorkspacePickerDialog({
  open,
  onOpenChange,
  onSelect,
  initialPath,
  title = 'Select a folder',
}: WorkspacePickerDialogProps) {
  const { path, setPath, list, busy, loadDirectories } = useWorkspaceBrowser()
  const listRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const pendingFocus = useRef(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const rows = useMemo<Row[]>(() => {
    if (!list) return []
    return [
      ...(list.parent
        ? [{ name: '..', target: list.parent, isParent: true }]
        : []),
      ...list.entries.slice(0, 500).map((entry) => ({
        name: entry.name,
        target: entry.path,
      })),
    ]
  }, [list])

  useEffect(() => {
    if (open) void loadDirectories(initialPath || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Run once
  }, [open])

  // Preserve focus while navigating the list
  useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    rowRefs.current[0]?.focus()
  }, [list?.path])

  function navigate(target?: string) {
    pendingFocus.current = true
    setActiveIndex(0)
    void loadDirectories(target)
  }

  function move(delta: number) {
    if (rows.length === 0) return
    const next =
      activeIndex < 0
        ? delta > 0
          ? 0
          : rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, activeIndex + delta))
    setActiveIndex(next)
    const el = rowRefs.current[next]
    el?.focus()
    el?.scrollIntoView({ block: 'nearest' })
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
    }
  }

  function handleSelect() {
    if (!path.trim()) return
    onSelect(path.trim())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="sm:max-w-2xl" initialFocus={listRef}>
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <div className="flex flex-col gap-3 py-2" onKeyDown={handleKeyDown}>
          <div className="flex gap-2">
            <Input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') navigate(path.trim())
              }}
              placeholder="/path/to/project"
              className="h-9 font-mono text-xs"
            />
            <RippleButton
              size="icon"
              variant="input"
              disabled={busy || !path.trim()}
              onClick={() => navigate(path.trim())}
            >
              <ArrowRightIcon />
            </RippleButton>
          </div>
          <div
            ref={listRef}
            tabIndex={-1}
            role="listbox"
            aria-label="Directories"
            className="border-border/50 h-72 overflow-auto rounded-md border"
          >
            {rows.map((row, index) => (
              <DirectoryRow
                key={row.target ?? row.name}
                ref={(el) => {
                  rowRefs.current[index] = el
                }}
                name={row.name}
                active={index === activeIndex}
                icon={
                  row.isParent ? (
                    <CornerLeftUpIcon className="size-3.5 shrink-0" />
                  ) : undefined
                }
                onClick={() => navigate(row.target)}
              />
            ))}
            {list && rows.length === 0 && (
              <p className="text-muted-foreground p-3 text-xs">
                No subfolders here.
              </p>
            )}
          </div>
        </div>
        <Dialog.Footer className="flex-row">
          <RippleButton
            variant="input"
            onClick={() => onOpenChange(false)}
            className="ml-auto w-32"
          >
            Cancel
          </RippleButton>
          <RippleButton
            variant="primary"
            disabled={busy || !path.trim()}
            onClick={handleSelect}
            className="w-32"
          >
            Use this folder
          </RippleButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}

function DirectoryRow({
  ref,
  name,
  icon,
  active,
  onClick,
}: {
  ref?: React.Ref<HTMLButtonElement>
  name: string
  icon?: React.ReactNode
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active}
      className={cn(
        'focus-visible:border-ring hover:bg-m3-surface-container-high flex w-full items-center gap-2 rounded-md border border-transparent px-3 py-1.5 text-left text-xs outline-0',
        active && 'bg-m3-surface-container-high',
      )}
      onClick={onClick}
    >
      {icon ?? <FolderIcon className="size-3.5 shrink-0" />}
      <span className="truncate font-mono">{name}</span>
    </button>
  )
}
