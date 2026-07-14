
import { RotateCcwIcon } from 'lucide-react'
import * as React from 'react'

import { HelpPopoverLabel } from './help'
import { NumberInput } from './number-input'

export function ParamNumberInput({
  label,
  help,
  description,
  value,
  defaultValue,
  minValue,
  maxValue,
  step,
  onChange,
  disabled,
}: {
  label: string
  help?: React.ReactNode
  description?: React.ReactNode
  value: number
  defaultValue?: number
  minValue?: number
  maxValue?: number
  step?: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <div data-slot="param-number-input" className="flex flex-col gap-1">
      <div className="flex h-6 items-center gap-1.5">
        <HelpPopoverLabel help={help}>{label}</HelpPopoverLabel>
        {defaultValue !== undefined && value !== defaultValue && (
          <button
            type="button"
            onClick={() => onChange(defaultValue)}
            disabled={disabled}
            className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded transition-colors disabled:opacity-50"
            title="Reset to default"
          >
            <RotateCcwIcon className="size-4" />
          </button>
        )}
      </div>
      {description && (
        <p className="text-muted-foreground text-sm leading-normal">
          {description}
        </p>
      )}
      <NumberInput
        value={value}
        onChange={onChange}
        minValue={minValue}
        maxValue={maxValue}
        step={step}
        disabled={disabled}
        className="mt-2 w-48 max-w-full self-center"
      />
    </div>
  )
}
