import { Combobox, Switch } from '@/components/ui'
import { useStableValue } from '@/hooks'
import { useActiveModelSettings, useAgentPicker } from '@/hooks/chat'
import { cn } from '@/lib/utils'
import { useMemo, useRef, useState } from 'react'

import { ModelPicker, ReasoningPicker } from '../models'
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
  const modelSettings = useActiveModelSettings()

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
          <div className="flex items-center justify-end gap-2 px-2 py-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              Show all agents
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
      footer={
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-2">
          <PickerField label="Model">
            <ModelPicker
              className="w-full"
              value={modelSettings.model?.id ?? ''}
              selectedModel={modelSettings.model}
              onValueChange={modelSettings.setModel}
              disabled={!modelSettings.editable}
            />
          </PickerField>
          {modelSettings.model?.reasoning?.type !== 'none' && (
            <PickerField label="Reasoning">
              <ReasoningPicker
                className="w-full"
                value={modelSettings.reasoningEffort ?? 'auto'}
                onValueChange={modelSettings.setReasoningEffort}
                model={modelSettings.model}
                disabled={!modelSettings.editable}
              />
            </PickerField>
          )}
        </div>
      }
      trigger={
        <Combobox.Trigger
          variant="stealth"
          className={cn(
            'text-muted-foreground h-10 w-fit max-w-full min-w-0 shrink',
            displayAgent && 'pl-1.25!',
            className,
          )}
          aria-label="Select agent"
        >
          <Combobox.DisplayValue placeholder="Select agent…">
            <AgentItemLabel agent={displayAgent} />
          </Combobox.DisplayValue>
        </Combobox.Trigger>
      }
    />
  )
}

function PickerField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      {children}
    </div>
  )
}
