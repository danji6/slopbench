import { Combobox, type ComboboxTriggerProps } from '@/components/ui'
import { useModelSettings } from '@/hooks/chat'
import { useModels } from '@/hooks/chat'
import { cn } from '@/lib/utils'
import { useMemo } from 'react'

export type ModelPickerProps = ComboboxTriggerProps & {
  className?: string
  disabled?: boolean
  /** Controlled mode: current model id */
  value?: string
  /** Controlled mode: called with new model id */
  onValueChange?: (value: string) => void
}

export function ModelPicker({
  disabled = false,
  className,
  value: controlledValue,
  onValueChange: controlledOnChange,
  ...props
}: ModelPickerProps) {
  const { model, setModel, initialModel } = useModelSettings()
  const { models, isLoading } = useModels()

  const isControlled =
    controlledValue !== undefined || controlledOnChange !== undefined

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

  if (!isControlled && initialModel) {
    return null
  }

  const value = isControlled ? (controlledValue ?? '') : (model?.id ?? '')
  const handleChange = isControlled
    ? (v: string) => controlledOnChange?.(v || '')
    : (v: string) => setModel(v || '')

  return (
    <Combobox value={value} onValueChange={handleChange} noDeselect>
      <Combobox.Trigger
        variant="stealth"
        className={cn(
          'text-muted-foreground w-[calc(min(fit-content,100%,200px))]',
          className,
        )}
        disabled={disabled || isLoading || models.length === 0}
        {...props}
      >
        <Combobox.DisplayValue placeholder="Select model...">
          {(val) => {
            const m = models.find((m) => m.id === val)
            return m ? (m.label ?? m.id) : undefined
          }}
        </Combobox.DisplayValue>
      </Combobox.Trigger>
      <Combobox.Content
        align="start"
        className="w-[calc(min(fit-content,100%,200px))]"
      >
        <Combobox.Search />
        <Combobox.List>
          <Combobox.Empty>No models found.</Combobox.Empty>
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
