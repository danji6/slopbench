
import { useStep } from '@/hooks/step'
import { clamp, roundDecimals } from '@/lib/math'
import { MinusIcon, PlusIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { InputGroup } from './input-group'

export type NumberInputProps = {
  value?: number
  minValue?: number
  maxValue?: number
  step?: number
  decimals?: number
  stepDelay?: number
  stepStrength?: number
  onChange?: (value: number) => void
} & Omit<React.ComponentProps<'input'>, 'value' | 'onChange'>

export function NumberInput({
  value,
  minValue = -Infinity,
  maxValue = Infinity,
  step = 1,
  decimals = 2,
  stepDelay,
  stepStrength,
  onChange,
  className,
  ...props
}: NumberInputProps) {
  const isControlled = value !== undefined
  const [internalValue, setInternalValue] = useState<number>(value ?? 0)
  const [rawInput, setRawInput] = useState<string | null>(null)
  const [prevPropValue, setPrevPropValue] = useState<number | undefined>(value)

  // Sync from props if there's an external change
  if (isControlled && value !== prevPropValue) {
    setPrevPropValue(value)
    if (value !== undefined) setInternalValue(value)
  }

  const displayValue = rawInput ?? internalValue

  function handleChange(direction: number, textValue?: string) {
    if (direction === 0 && textValue !== undefined) {
      const stringValue = String(textValue)
      setRawInput(stringValue)

      if (
        stringValue === '-' ||
        stringValue === '' ||
        stringValue.endsWith('.')
      ) {
        return
      }

      const newValue = Number(stringValue)
      if (!Number.isNaN(newValue)) {
        setInternalValue(newValue)
      }
      return
    }

    setRawInput(null)
    setInternalValue((prev) => {
      let newValue = Number(prev)
      if (Number.isNaN(newValue)) return prev

      if (Number.isInteger(step)) {
        const rounded = roundDecimals(newValue, decimals)
        newValue =
          direction > 0 ? Math.floor(rounded) + step : Math.ceil(rounded) - step
      } else {
        newValue = roundDecimals(newValue, decimals) + direction * step
      }

      return clamp(newValue, minValue, maxValue)
    })
  }

  const [stepDirection, setStepDirection] = useStep(
    (direction) => {
      handleChange(direction)
    },
    stepDelay,
    stepStrength,
  )

  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Debounce notification or trigger immediately on mouse up
  useEffect(() => {
    if (internalValue === prevPropValue) return

    // Wait until stepping is done
    if (stepDirection !== 0) return

    const timeoutId = setTimeout(
      () => {
        onChangeRef.current?.(internalValue)
      },
      rawInput !== null ? 300 : 0,
    )

    return () => clearTimeout(timeoutId)
  }, [internalValue, prevPropValue, stepDirection, rawInput])

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    let newValue = Number(rawInput ?? internalValue)
    setRawInput(null)

    if (!Number.isNaN(newValue)) {
      newValue = clamp(roundDecimals(newValue, decimals), minValue, maxValue)
      setInternalValue(newValue)
      if (newValue !== prevPropValue) {
        onChange?.(newValue)
      }
    }

    props.onBlur?.(e)
  }

  function handlePointerUp() {
    setStepDirection(0)
  }

  return (
    <InputGroup
      data-slot="number-input"
      className={className}
      disabled={props.disabled}
    >
      <InputGroup.Input
        {...props}
        className="text-center"
        value={displayValue}
        onChange={(e) => handleChange(0, e.target.value)}
        onBlur={handleBlur}
      />
      <InputGroup.Addon align="inline-start">
        <InputGroup.Button
          disabled={props.disabled}
          onPointerDown={() => setStepDirection(-1)}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <MinusIcon />
        </InputGroup.Button>
      </InputGroup.Addon>
      <InputGroup.Addon align="inline-end">
        <InputGroup.Button
          disabled={props.disabled}
          onPointerDown={() => setStepDirection(1)}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <PlusIcon />
        </InputGroup.Button>
      </InputGroup.Addon>
    </InputGroup>
  )
}
