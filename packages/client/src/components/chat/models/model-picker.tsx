import { Combobox, type ComboboxTriggerProps } from '@/components/ui'
import { useModels } from '@/hooks/chat'
import { useProviderDiscoveryCoordinator } from '@/hooks/chat/provider-discovery'
import type { UIModel } from '@/lib/chat'
import { cn } from '@/lib/utils'
import { useMemo, useState } from 'react'

export type ModelPickerProps = ComboboxTriggerProps & {
  className?: string
  disabled?: boolean
  value: string
  onValueChange: (value: string) => void
  selectedModel?: UIModel | null
  inheritLabel?: string
  allowDeselect?: boolean
}

export function ModelPicker({
  disabled = false,
  className,
  value,
  onValueChange,
  selectedModel,
  inheritLabel,
  allowDeselect = false,
  ...props
}: ModelPickerProps) {
  const { models, isLoading } = useModels()
  const [open, setOpen] = useState(false)
  const emptyLabel = inheritLabel ?? (allowDeselect ? 'None' : undefined)
  useProviderDiscoveryCoordinator(open)

  const groups = useMemo(() => {
    const groups = new Map<string, UIModel[]>()
    for (const model of models) {
      const name =
        model.connectionId ??
        model.connectionName ??
        (model.local ? 'Local Models' : 'Cloud Models')
      const group = groups.get(name) ?? []
      group.push(model)
      groups.set(name, group)
    }
    return [...groups]
  }, [models])

  return (
    <Combobox
      onOpenChange={setOpen}
      value={emptyLabel && !value ? '__empty__' : value}
      onValueChange={(v) =>
        onValueChange(emptyLabel && v === '__empty__' ? '' : v || '')
      }
      noDeselect={!allowDeselect}
    >
      <Combobox.Trigger
        variant="input"
        className={cn(
          'text-muted-foreground w-[calc(min(fit-content,100%,200px))]',
          className,
        )}
        disabled={
          disabled || (!emptyLabel && (isLoading || models.length === 0))
        }
        {...props}
      >
        <Combobox.DisplayValue placeholder="Select model…">
          {(val) => {
            if (emptyLabel && val === '__empty__') return emptyLabel
            const m =
              models.find((candidate) => candidate.id === val) ??
              (selectedModel?.id === val ? selectedModel : undefined)
            return m
              ? `${m.label ?? m.id}${m.available === false ? ' (unavailable)' : ''}`
              : val
                ? 'Unavailable model, check your settings'
                : undefined
          }}
        </Combobox.DisplayValue>
      </Combobox.Trigger>
      <Combobox.Content
        align="start"
        className={
          inheritLabel
            ? 'w-72 max-w-[calc(100dvw-2rem)]'
            : 'w-[calc(min(fit-content,100%,200px))]'
        }
      >
        <Combobox.Search />
        <Combobox.List>
          <Combobox.Empty>No models found.</Combobox.Empty>
          {emptyLabel && (
            <Combobox.Item value="__empty__">{emptyLabel}</Combobox.Item>
          )}
          {groups.map(([name, entries]) => (
            <Combobox.Group
              key={name}
              heading={entries[0]?.connectionName ?? name}
            >
              {entries.map((model) => (
                <Combobox.Item
                  key={model.id}
                  value={model.id}
                  disabled={model.available === false}
                >
                  {model.label ?? model.id}
                  {model.available === false ? ' (not listed)' : ''}
                </Combobox.Item>
              ))}
            </Combobox.Group>
          ))}
        </Combobox.List>
      </Combobox.Content>
    </Combobox>
  )
}
