import { Combobox, Switch } from '@/components/ui'
import { useStableValue } from '@/hooks'
import { useAgentPicker } from '@/hooks/chat'
import { cn } from '@/lib/utils'
import { useMemo, useRef, useState } from 'react'

import { AgentCombobox, type AgentItem, AgentItemLabel } from './agent-combobox'

type ChatAgentPickerProps = {
  className?: string
  fallbackAgent?: AgentItem
}

export function ChatAgentPicker({
  className,
  fallbackAgent,
}: ChatAgentPickerProps) {
  const { inSession, options, linkedIds, selectedId, select } = useAgentPicker()
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const pendingSelection = useRef<string | null>(null)
  const showLinkedOnly = inSession && !showAll && linkedIds.size > 0
  const visible = useMemo(
    () =>
      showLinkedOnly ? options.filter((option) => option.linked) : options,
    [showLinkedOnly, options],
  )

  const selected = options.find((option) => option.id === selectedId)
  const stableSelected = useStableValue(
    selected,
    Boolean(selectedId && !selected),
  )
  const displayAgent = stableSelected ?? fallbackAgent

  return (
    <AgentCombobox
      agents={visible}
      value={selectedId}
      onValueChange={(next) => {
        pendingSelection.current = next
      }}
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nextOpen) => {
        if (nextOpen || pendingSelection.current === null) return
        const next = pendingSelection.current
        pendingSelection.current = null
        select(next)
      }}
      header={
        inSession && (
          <div className="flex items-center justify-between gap-5 px-2 py-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              All agents
            </span>
            <Switch
              size="xs"
              checked={showAll}
              onCheckedChange={setShowAll}
              aria-label="Show all agents"
            />
          </div>
        )
      }
      trigger={
        <Combobox.Trigger
          variant="stealth"
          className={cn(
            'text-muted-foreground h-10 w-fit max-w-full min-w-0 shrink',
            displayAgent && 'pl-[5px]!',
            className,
          )}
          aria-label="Select agent"
        >
          <Combobox.DisplayValue placeholder="Select agent...">
            <AgentItemLabel agent={displayAgent} />
          </Combobox.DisplayValue>
        </Combobox.Trigger>
      }
    />
  )
}
