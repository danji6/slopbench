import { Command } from '@/components/ui/command'
import type { MentionEntry } from '@/lib/chat/file-mentions'
import { FileIcon, FolderIcon } from 'lucide-react'

export type FileMentionPickerProps = {
  matches: MentionEntry[]
  selectedIndex: number
  onSelectedIndexChange: (index: number) => void
  onSelect: (entry: MentionEntry) => void
}

export function FileMentionPicker({
  matches,
  selectedIndex,
  onSelectedIndexChange,
  onSelect,
}: FileMentionPickerProps) {
  if (matches.length === 0) return null

  const selectedValue = (matches[selectedIndex] ?? matches[0]).path

  return (
    <div
      data-slot="file-mention-picker"
      className="bg-m3-surface-container-low absolute right-0 bottom-full left-0 mb-1 max-h-72 overflow-hidden rounded-xl border shadow-lg"
    >
      <Command
        shouldFilter={false}
        value={selectedValue}
        onValueChange={(value) => {
          const index = matches.findIndex((entry) => entry.path === value)
          if (index >= 0) onSelectedIndexChange(index)
        }}
      >
        <Command.CommandList>
          {matches.map((entry) => (
            <Command.CommandItem
              key={entry.path}
              value={entry.path}
              onSelect={() => onSelect(entry)}
              className="flex items-center gap-2 rounded-lg px-3 py-2"
            >
              {entry.isDir ? (
                <FolderIcon className="text-muted-foreground size-4 shrink-0" />
              ) : (
                <FileIcon className="text-muted-foreground size-4 shrink-0" />
              )}
              <span className="truncate font-mono text-sm">
                {basename(entry.path)}
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {dirname(entry.path)}
              </span>
            </Command.CommandItem>
          ))}
        </Command.CommandList>
      </Command>
    </div>
  )
}

function basename(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const name = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return path.endsWith('/') ? `${name}/` : name
}

function dirname(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const index = trimmed.lastIndexOf('/')
  return index < 0 ? '' : trimmed.slice(0, index)
}
