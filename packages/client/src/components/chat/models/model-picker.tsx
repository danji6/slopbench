import {
  Combobox,
  type ComboboxContentProps,
  type ComboboxTriggerProps,
} from '@/components/ui'
import { useModels } from '@/hooks/chat'
import { useProviderDiscoveryCoordinator } from '@/hooks/chat/provider-discovery'
import type { UIModel } from '@/lib/chat'
import { cn } from '@/lib/utils'
import { parseModelReference } from '@cv/core/model-reference'
import { useMemo, useState } from 'react'

export type ModelPickerProps = ComboboxTriggerProps & {
  className?: string
  side?: ComboboxContentProps['side']
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
  side,
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
            if (!val) return undefined

            const model = models.find((candidate) => candidate.id === val)
            if (model) {
              const label = model.label ?? parseModelReference(val).modelId
              return model.available === false
                ? `${label} (unavailable)`
                : label
            }
            if (disabled && selectedModel?.id === val && selectedModel.label) {
              return selectedModel.label
            }
            return 'Unavailable model, check your settings'
          }}
        </Combobox.DisplayValue>
      </Combobox.Trigger>
      <Combobox.Content
        side={side}
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
                  searchText={model.label ?? model.id}
                  disabled={model.available === false}
                >
                  {model.label ?? model.id}
                  {model.available === false ? ' (unavailable)' : ''}
                </Combobox.Item>
              ))}
            </Combobox.Group>
          ))}
        </Combobox.List>
      </Combobox.Content>
    </Combobox>
  )
}
