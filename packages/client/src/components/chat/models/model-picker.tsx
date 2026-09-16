import { Combobox, type ComboboxTriggerProps } from '@/components/ui'
import { useModels } from '@/hooks/chat'
import type { UIModel } from '@/lib/chat'
import { cn } from '@/lib/utils'
import { useMemo } from 'react'

export type ModelPickerProps = ComboboxTriggerProps & {
  className?: string
  disabled?: boolean
  value: string
  onValueChange: (value: string) => void
  selectedModel?: UIModel | null
  inheritLabel?: string
}

export function ModelPicker({
  disabled = false,
  className,
  value,
  onValueChange,
  selectedModel,
  inheritLabel,
  ...props
}: ModelPickerProps) {
  const { models, isLoading } = useModels()

  const [localModels, cloudModels] = useMemo(() => {
    return models.reduce(
      (acc, m) => {
        if (m.local) {
          acc[0].push(
            <Combobox.Item key={m.id} value={m.id}>
              {m.label ?? m.id}
            </Combobox.Item>,
          )
        } else {
          acc[1].push(
            <Combobox.Item key={m.id} value={m.id}>
              {m.label ?? m.id}
            </Combobox.Item>,
          )
        }
        return acc
      },
      [[] as React.ReactNode[], [] as React.ReactNode[]],
    )
  }, [models])

  return (
    <Combobox
      value={inheritLabel && !value ? '__inherit__' : value}
      onValueChange={(v) =>
        onValueChange(inheritLabel && v === '__inherit__' ? '' : v || '')
      }
      noDeselect
    >
      <Combobox.Trigger
        variant="input"
        className={cn(
          'text-muted-foreground w-[calc(min(fit-content,100%,200px))]',
          className,
        )}
        disabled={
          disabled || (!inheritLabel && (isLoading || models.length === 0))
        }
        {...props}
      >
        <Combobox.DisplayValue placeholder="Select model…">
          {(val) => {
            if (inheritLabel && val === '__inherit__') return inheritLabel
            const m =
              models.find((candidate) => candidate.id === val) ??
              (selectedModel?.id === val ? selectedModel : undefined)
            return m ? (m.label ?? m.id) : undefined
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
          {inheritLabel && (
            <Combobox.Item value="__inherit__">{inheritLabel}</Combobox.Item>
          )}
          <Combobox.Group heading="Cloud Models">{cloudModels}</Combobox.Group>
          {localModels.length > 0 && (
            <>
              <Combobox.Separator />
              <Combobox.Group heading="Local Models">
                {localModels}
              </Combobox.Group>
            </>
          )}
        </Combobox.List>
      </Combobox.Content>
    </Combobox>
  )
}
