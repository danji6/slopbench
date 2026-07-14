import { cn } from '@/lib/utils'
import { RotateCcwIcon } from 'lucide-react'
import * as React from 'react'

import { HelpPopoverLabel } from './help'
import { Textarea } from './textarea'

export function ParamTextarea({
  label,
  help,
  description,
  value,
  defaultValue,
  onChange,
  disabled,
  className,
  textareaClassName,
  ...props
}: Omit<
  React.ComponentProps<typeof Textarea>,
  'value' | 'defaultValue' | 'onChange' | 'className'
> & {
  label: string
  help?: React.ReactNode
  description?: React.ReactNode
  value: string
  defaultValue?: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  textareaClassName?: string
}) {
  return (
    <div
      data-slot="param-textarea"
      className={cn('flex flex-col gap-1', className)}
    >
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
      <Textarea
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={cn('mt-2', textareaClassName)}
      />
    </div>
  )
}
