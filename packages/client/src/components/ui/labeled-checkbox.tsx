import { useCompactText } from '@/hooks/compact-text'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

import { Checkbox, type CheckboxProps } from './checkbox'
import { Label } from './label'

export type CheckboxLabelProps = Omit<
  CheckboxProps,
  'children' | 'className'
> & {
  children: ReactNode
  className?: string
  checkboxClassName?: string
  labelClassName?: string
  align?: 'center' | 'start'
}

/** Keeps a checkbox beside its wrapping label with a consistent gap. */
export function LabeledCheckbox({
  children,
  className,
  checkboxClassName,
  labelClassName,
  align = 'center',
  disabled,
  ...props
}: CheckboxLabelProps) {
  const textRef = useCompactText(children, `${className} ${labelClassName}`)

  return (
    <Label
      className={cn(
        'inline-grid w-fit max-w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2',
        align === 'start' ? 'items-start' : 'items-center',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        className,
      )}
    >
      <Checkbox
        {...props}
        disabled={disabled}
        className={cn(align === 'start' && 'mt-0.5', checkboxClassName)}
      />
      <span
        ref={textRef}
        className={cn(
          'min-w-0 text-left leading-normal wrap-anywhere whitespace-normal',
          disabled && 'opacity-50',
          labelClassName,
        )}
      >
        {children}
      </span>
    </Label>
  )
}
