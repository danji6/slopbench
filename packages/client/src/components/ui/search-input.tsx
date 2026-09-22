import { cn } from '@/lib/utils'
import { XIcon } from 'lucide-react'
import type * as React from 'react'

import { InputGroup, type InputGroupProps } from './input-group'

export type SearchInputProps = Omit<
  React.ComponentProps<'input'>,
  'className' | 'onChange' | 'type' | 'value' | 'variant'
> & {
  value: string
  onValueChange: (value: string) => void
  clearLabel?: string
  className?: string
  inputClassName?: string
  variant?: InputGroupProps['variant']
}

/** Renders a search field with a Material-style clear action. */
export function SearchInput({
  value,
  onValueChange,
  clearLabel = 'Clear search',
  className,
  inputClassName,
  variant = 'outline',
  disabled,
  ...props
}: SearchInputProps) {
  return (
    <InputGroup className={className} variant={variant} disabled={disabled}>
      <InputGroup.Input
        {...props}
        type="search"
        disabled={disabled}
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        className={cn(
          'pl-4 [&::-webkit-search-cancel-button]:hidden',
          inputClassName,
        )}
      />
      {value && !disabled && (
        <InputGroup.Addon align="inline-end">
          <InputGroup.Button
            variant="stealth"
            aria-label={clearLabel}
            onClick={() => onValueChange('')}
          >
            <XIcon />
          </InputGroup.Button>
        </InputGroup.Addon>
      )}
    </InputGroup>
  )
}
