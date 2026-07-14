import { clamp } from '@/lib/math'
import { cn } from '@/lib/utils'
import { RotateCcwIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { HelpPopoverLabel } from './help'
import { Input } from './input'
import { Slider, type SliderProps } from './slider'
import { Switch } from './switch'

type ParamSliderBaseProps = Omit<SliderProps, 'value' | 'onChange'> & {
  label: string | React.ReactNode
  help?: React.ReactNode
  defaultValue?: number
  minValue: number
  maxValue: number
  step: number
  disabled?: boolean
  thumbClassName?: string
}

export type ParamSliderProps = ParamSliderBaseProps &
  (
    | {
        optional?: false
        value: number
        onChange: (value: number) => void
      }
    | {
        optional: true
        value?: number
        onChange: (value: number | undefined) => void
      }
  )

export function ParamSlider({
  label,
  help,
  value,
  defaultValue,
  minValue,
  maxValue,
  step,
  onChange,
  disabled,
  className,
  thumbClassName,
  optional,
  ...props
}: ParamSliderProps) {
  const fallbackValue = defaultValue ?? minValue
  const enabled = !optional || value !== undefined
  const effectiveDisabled = disabled || !enabled
  const resolvedValue = value ?? fallbackValue
  const [internalValue, setInternalValue] = useState(resolvedValue)
  const [prevValueProp, setPrevValueProp] = useState(resolvedValue)
  const [rawInput, setRawInput] = useState<string | null>(null)
  const commitNumber = onChange as (value: number) => void

  if (!Object.is(resolvedValue, prevValueProp)) {
    setPrevValueProp(resolvedValue)
    setInternalValue(
      Number.isNaN(resolvedValue) ? prevValueProp : resolvedValue,
    )
    setRawInput(null)
  }

  useEffect(() => {
    if (!enabled) return
    if (Object.is(internalValue, value)) return
    if (Number.isNaN(internalValue)) return
    const timeoutId = setTimeout(() => {
      commitNumber(internalValue)
    }, 200)
    return () => clearTimeout(timeoutId)
  }, [commitNumber, enabled, internalValue, value])

  const displayValue = rawInput ?? internalValue

  function handleInputChange(textValue: string) {
    setRawInput(textValue)

    if (textValue === '-' || textValue === '' || textValue.endsWith('.')) {
      return
    }

    const newValue = Number(textValue)
    if (!Number.isNaN(newValue)) {
      setInternalValue(newValue)
    }
  }

  function handleInputBlur() {
    const newValue = Number(rawInput ?? internalValue)
    setRawInput(null)

    if (!Number.isNaN(newValue)) {
      setInternalValue(newValue)
    }
  }

  return (
    <div data-slot="param-slider" className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <HelpPopoverLabel help={help}>{label}</HelpPopoverLabel>
        <div className="flex items-center gap-2.5">
          {defaultValue !== undefined && internalValue !== defaultValue && (
            <button
              type="button"
              onClick={() => onChange(defaultValue)}
              disabled={effectiveDisabled}
              className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded transition-colors disabled:opacity-50"
              title="Reset to default"
            >
              <RotateCcwIcon className="size-4" />
            </button>
          )}
          {optional && (
            <Switch
              size="xs"
              checked={enabled}
              disabled={disabled}
              onCheckedChange={(checked) => {
                onChange(checked ? internalValue : undefined)
              }}
            />
          )}
          <Input
            value={displayValue}
            onChange={(e) => handleInputChange(e.target.value)}
            onBlur={handleInputBlur}
            disabled={effectiveDisabled}
            className="h-8 w-16 text-center text-xs tabular-nums"
          />
        </div>
      </div>
      <Slider
        className={cn('data-horizontal:w-full', className)}
        value={[clamp(internalValue, minValue, maxValue)]}
        minValue={minValue}
        maxValue={maxValue}
        step={step}
        disabled={effectiveDisabled}
        thumbClassName={thumbClassName}
        onValueChange={(v: number | readonly number[]) => {
          const num = typeof v === 'number' ? v : v?.[0]
          if (typeof num === 'number' && !Number.isNaN(num)) {
            setInternalValue(num)
            setRawInput(null)
          }
        }}
        {...props}
      />
    </div>
  )
}
