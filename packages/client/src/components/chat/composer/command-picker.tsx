import { Command } from '@/components/ui/command'
import type { CommandDefinition } from '@/lib/chat/commands/types'
import { useEffect, useState } from 'react'

export type CommandPickerProps = {
  query: string
  commands: CommandDefinition[]
  onSelect: (command: CommandDefinition) => void
  onAutocomplete: (command: CommandDefinition) => void
  onDismiss: () => void
}

export function CommandPicker({
  query,
  commands,
  onSelect,
  onAutocomplete,
  onDismiss,
}: CommandPickerProps) {
  const normalizedQuery = query.toLowerCase()
  const filtered = commands.filter((c) =>
    [c.name, ...(c.aliases ?? [])].some((name) =>
      name.toLowerCase().startsWith(normalizedQuery),
    ),
  )

  const [selectedName, setSelectedName] = useState(filtered[0]?.name ?? '')
  const [prevQuery, setPrevQuery] = useState(query)

  if (prevQuery !== query) {
    setPrevQuery(query)
    setSelectedName(filtered[0]?.name ?? '')
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!filtered.length) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const idx = filtered.findIndex((c) => c.name === selectedName)
        setSelectedName(filtered[(idx + 1) % filtered.length]!.name)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const idx = filtered.findIndex((c) => c.name === selectedName)
        setSelectedName(
          filtered[(idx - 1 + filtered.length) % filtered.length]!.name,
        )
      } else if (e.key === 'Tab') {
        e.preventDefault()
        const cmd = filtered.find((c) => c.name === selectedName)
        if (cmd) onAutocomplete(cmd)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filtered.find((c) => c.name === selectedName)
        if (cmd) onSelect(cmd)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [filtered, selectedName, onSelect, onDismiss, onAutocomplete])

  if (filtered.length === 0) return null

  return (
    <div
      data-slot="command-picker"
      className="bg-m3-surface-container-low absolute right-0 bottom-full left-0 mb-1 overflow-hidden rounded-xl border shadow-lg"
    >
      <Command
        shouldFilter={false}
        value={selectedName}
        onValueChange={setSelectedName}
      >
        <Command.CommandList>
          {filtered.map((cmd) => (
            <Command.CommandItem
              key={cmd.name}
              value={cmd.name}
              onSelect={() => onSelect(cmd)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5"
            >
              <span className="font-mono text-sm font-medium">/{cmd.name}</span>
              <div className="text-muted-foreground flex flex-col text-xs">
                <span>{cmd.description}</span>
                <span>
                  {cmd.aliases?.length
                    ? ` (aliases: ${cmd.aliases.join(', ')})`
                    : ''}
                </span>
              </div>
            </Command.CommandItem>
          ))}
        </Command.CommandList>
      </Command>
    </div>
  )
}
