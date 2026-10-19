import { Dialog, RippleButton } from '@/components/ui'
import { useWorkspaceBrowser } from '@/hooks/chat'
import { rememberDirectory } from '@/lib/chat/recent-directory-store'
import { cn } from '@/lib/utils'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  HouseIcon,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { SkillDiscoveryToggle } from './skill-discovery-toggle'
import { WorkspacePathInput } from './workspace-path-input'

interface WorkspacePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (root: string, discoverSkills?: boolean) => void
  skillDiscovery?: boolean
  initialPath?: string
  title?: string
}

type Row = { name: string; target: string }

export function WorkspacePickerDialog({
  open,
  onOpenChange,
  onSelect,
  initialPath,
  skillDiscovery = false,
  title = 'Choose a directory',
}: WorkspacePickerDialogProps) {
  const {
    path,
    setPath,
    pathError,
    list,
    busy,
    loadDirectories,
    showHidden,
    toggleShowHidden,
    canGoBack,
    goBack,
    goUp,
    goHome,
  } = useWorkspaceBrowser()
  const listRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const pendingFocus = useRef(false)
  const selectionVersion = useRef(0)
  const [activeIndex, setActiveIndex] = useState(-1)
  const pathErrorId = useId()
  const [discoverSkills, setDiscoverSkills] = useState(true)

  const rows = useMemo<Row[]>(() => {
    return (list?.entries ?? []).slice(0, 500).map((entry) => ({
      name: entry.name,
      target: entry.path,
    }))
  }, [list])

  useEffect(() => {
    const version = selectionVersion.current
    if (open) {
      void loadDirectories(initialPath || undefined, true)
    }
    return () => {
      selectionVersion.current = version + 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Run once
  }, [open])

  // Preserve focus while navigating the list
  useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    const target = rowRefs.current[0] ?? listRef.current
    target?.focus()
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

  function handleOpenChange(next: boolean) {
    if (!next) setDiscoverSkills(true)
    onOpenChange(next)
  }

  async function handleSelect() {
    if (busy || !path.trim()) return
    const version = selectionVersion.current
    const selected = await loadDirectories(path.trim())
    if (!selected) return
    if (version !== selectionVersion.current) return
    onSelect(selected.path, skillDiscovery ? discoverSkills : undefined)
    rememberDirectory(selected.path)
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content className="sm:max-w-2xl" initialFocus={listRef}>
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-center gap-1">
            <RippleButton
              size="icon"
              variant="input"
              disabled={!canGoBack || busy}
              onClick={goBack}
              aria-label="Back"
              title="Back"
            >
              <ArrowLeftIcon />
            </RippleButton>
            <RippleButton
              size="icon"
              variant="input"
              disabled={busy || !list?.parent}
              onClick={goUp}
              aria-label="Up"
              title="Up"
            >
              <ArrowUpIcon />
            </RippleButton>
            <RippleButton
              size="icon"
              variant="input"
              disabled={busy}
              onClick={goHome}
              aria-label="Home"
              title="Home"
            >
              <HouseIcon />
            </RippleButton>
            <WorkspacePathInput
              value={path}
              onChange={setPath}
              onNavigate={navigate}
              errorId={pathError ? pathErrorId : undefined}
            />
            <RippleButton
              size="icon"
              variant="input"
              onClick={toggleShowHidden}
              aria-label={
                showHidden ? 'Hide hidden folders' : 'Show hidden folders'
              }
              title={showHidden ? 'Hide hidden folders' : 'Show hidden folders'}
            >
              {showHidden ? <EyeIcon /> : <EyeOffIcon />}
            </RippleButton>
            <RippleButton
              size="icon"
              variant="input"
              disabled={busy || !path.trim()}
              onClick={() => navigate(path.trim())}
            >
              <ArrowRightIcon />
            </RippleButton>
          </div>
          {pathError && (
            <p
              id={pathErrorId}
              role="alert"
              className="text-destructive px-3 text-xs"
            >
              {pathError}
            </p>
          )}
          <div
            ref={listRef}
            tabIndex={-1}
            role="listbox"
            aria-label="Directories"
            onKeyDown={handleKeyDown}
            className="border-border/50 h-72 overflow-auto rounded-md border outline-none"
          >
            {rows.map((row, index) => (
              <DirectoryRow
                key={row.target}
                ref={(el) => {
                  rowRefs.current[index] = el
                }}
                name={row.name}
                active={index === activeIndex}
                onClick={() => navigate(row.target)}
              />
            ))}
            {list && list.entries.length === 0 && (
              <p className="text-muted-foreground flex h-full items-center justify-center p-3 text-xs">
                Empty
              </p>
            )}
          </div>
        </div>
        {skillDiscovery && (
          <div className="space-y-2 pb-3">
            <SkillDiscoveryToggle
              checked={discoverSkills}
              onChange={setDiscoverSkills}
            />
            <p className="text-muted-foreground text-xs">
              Make skills in this directory available to agents. Instructions
              load when needed.
            </p>
          </div>
        )}
        <Dialog.Footer className="flex-row">
          <RippleButton
            variant="input"
            onClick={() => handleOpenChange(false)}
            className="ml-auto w-32"
          >
            Cancel
          </RippleButton>
          <RippleButton
            variant="primary"
            disabled={busy || !path.trim()}
            onClick={() => void handleSelect()}
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
  active,
  onClick,
}: {
  ref?: React.Ref<HTMLButtonElement>
  name: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      title={name}
      aria-selected={active}
      className={cn(
        'focus-visible:border-ring hover:bg-m3-surface-container-high flex w-full items-center gap-2 rounded-md border border-transparent px-3 py-1.5 text-left text-xs outline-0',
        active && 'bg-m3-surface-container-high',
      )}
      onClick={onClick}
    >
      <FolderIcon className="size-3.5 shrink-0" />
      <span className="truncate font-mono">{name}</span>
    </button>
  )
}
