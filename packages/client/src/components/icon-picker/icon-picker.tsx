import { Input, Popover, RippleButton, Tooltip } from '@/components/ui'
import { useDebouncedState } from '@/hooks'
import { cn, isClient } from '@/lib/utils'
import Fuse from 'fuse.js'
import type { IconName } from 'lucide-react/dynamic'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtualizer, type VirtualizerHandle } from 'virtua'

export type { IconName }

export function IconSvg({
  name,
  className,
}: {
  name: IconName
  className?: string
}) {
  const [svgContent, setSvgContent] = useState<string | undefined>()

  useEffect(() => {
    loadIconData().then((icons) => {
      setSvgContent(icons.find((i) => i.name === name)?.svgContent)
    })
  }, [name])

  if (!svgContent) return null

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  )
}

type IconData = {
  name: string
  categories: string[]
  tags: string[]
  svgContent: string
}

type Row =
  | { type: 'category'; name: string }
  | { type: 'icons'; items: IconData[] }

const COLS = 8
const PAGE_ROWS = 30
const SCROLL_THRESHOLD = 300

let dataPromise: Promise<IconData[]> | null = null

export function loadIconData(): Promise<IconData[]> {
  if (!dataPromise) {
    dataPromise = fetch('/assets/misc/icons-data.json').then((r) => r.json())
  }
  return dataPromise
}

if (isClient) {
  loadIconData()
}

export type IconPickerProps = {
  value?: IconName | null
  onValueChange?: (value: IconName) => void
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}

export function IconPicker({
  value,
  onValueChange,
  side = 'bottom',
  align = 'start',
}: IconPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useDebouncedState('', 200)
  const [icons, setIcons] = useState<IconData[] | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtuaRef = useRef<VirtualizerHandle>(null)

  useEffect(() => {
    if (!open || icons) return
    loadIconData().then(setIcons)
  }, [open, icons])

  const fuse = useMemo(
    () =>
      icons
        ? new Fuse(icons, {
            keys: ['name', 'tags', 'categories'],
            threshold: 0.3,
            ignoreLocation: true,
          })
        : null,
    [icons],
  )

  const rows = useMemo<Row[]>(() => {
    if (!icons) return []

    const filtered =
      debouncedSearch.trim() && fuse
        ? fuse.search(debouncedSearch.trim()).map((r) => r.item)
        : icons

    if (debouncedSearch.trim()) {
      const result: Row[] = []
      for (let i = 0; i < filtered.length; i += COLS) {
        result.push({ type: 'icons', items: filtered.slice(i, i + COLS) })
      }
      return result
    }

    const categoryMap = new Map<string, IconData[]>()
    for (const icon of filtered) {
      const cats = icon.categories.length > 0 ? icon.categories : ['other']
      for (const cat of cats) {
        if (!categoryMap.has(cat)) categoryMap.set(cat, [])
        categoryMap.get(cat)!.push(icon)
      }
    }

    const result: Row[] = []
    for (const [catName, catIcons] of [...categoryMap.entries()].sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      result.push({ type: 'category', name: catName })
      for (let i = 0; i < catIcons.length; i += COLS) {
        result.push({ type: 'icons', items: catIcons.slice(i, i + COLS) })
      }
    }
    return result
  }, [icons, fuse, debouncedSearch])

  const [rowLimit, setRowLimit] = useState(PAGE_ROWS)
  const [prevRows, setPrevRows] = useState(rows)

  if (rows !== prevRows) {
    setPrevRows(rows)
    if (rowLimit !== PAGE_ROWS) setRowLimit(PAGE_ROWS)
  }

  const visibleRows = rows.slice(0, rowLimit)
  const hasMore = rowLimit < rows.length

  const handleScroll = useCallback(() => {
    const v = virtuaRef.current
    if (!v || !hasMore) return
    if (v.scrollOffset + v.viewportSize >= v.scrollSize - SCROLL_THRESHOLD) {
      setRowLimit((l) => l + PAGE_ROWS)
    }
  }, [hasMore])

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value)
      setDebouncedSearch(e.target.value, 200)
    },
    [setDebouncedSearch],
  )

  const handleSelect = useCallback(
    (name: IconName) => {
      onValueChange?.(name)
      setOpen(false)
    },
    [onValueChange],
  )

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen)
      if (!isOpen) {
        setSearch('')
        setDebouncedSearch('', 0)
      }
    },
    [setDebouncedSearch],
  )

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={<RippleButton variant="input" size="icon" />}
        title="Choose icon"
      >
        {value ? (
          <IconSvg name={value} className="size-4" />
        ) : (
          <span className="text-muted-foreground text-[10px] leading-none">
            icon
          </span>
        )}
      </Popover.Trigger>
      <Popover.Content className="w-75 gap-2 p-2" side={side} align={align}>
        <Input
          value={search}
          onChange={handleSearchChange}
          placeholder="Search icons..."
          className="h-8 text-sm"
        />
        <Tooltip.Provider delay={500}>
          <div ref={scrollRef} className="max-h-64 overflow-y-auto">
            {!icons ? (
              <p className="text-muted-foreground py-6 text-center text-xs">
                Loading…
              </p>
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-xs">
                No icons found
              </p>
            ) : (
              <Virtualizer
                ref={virtuaRef}
                scrollRef={scrollRef as React.RefObject<HTMLElement>}
                data={visibleRows}
                onScroll={handleScroll}
              >
                {(row) =>
                  row.type === 'category' ? (
                    <CategoryHeader name={row.name} />
                  ) : (
                    <IconsRow
                      icons={row.items}
                      value={value}
                      onSelect={handleSelect}
                    />
                  )
                }
              </Virtualizer>
            )}
          </div>
        </Tooltip.Provider>
      </Popover.Content>
    </Popover>
  )
}

function CategoryHeader({ name }: { name: string }) {
  return (
    <div className="px-1 pt-2 pb-0.5">
      <p className="text-muted-foreground text-[11px] font-medium capitalize">
        {name}
      </p>
    </div>
  )
}

function IconsRow({
  icons,
  value,
  onSelect,
}: {
  icons: IconData[]
  value?: IconName | null
  onSelect: (name: IconName) => void
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5 py-0.5">
      {icons.map((icon) => (
        <IconCell
          key={icon.name}
          icon={icon}
          isSelected={icon.name === value}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

const IconCell = memo(function IconCell({
  icon,
  isSelected,
  onSelect,
}: {
  icon: IconData
  isSelected: boolean
  onSelect: (name: IconName) => void
}) {
  return (
    <Tooltip>
      <Tooltip.Trigger
        className={cn(
          'flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors',
          'hover:bg-m3-surface-container-high',
          isSelected && 'bg-primary/15 text-primary',
        )}
        onClick={() => onSelect(icon.name as IconName)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: icon.svgContent }}
        />
      </Tooltip.Trigger>
      <Tooltip.Content>{icon.name}</Tooltip.Content>
    </Tooltip>
  )
})
