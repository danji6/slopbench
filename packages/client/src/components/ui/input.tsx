import { cn } from '@/lib/utils'
import { Input as InputPrimitive } from '@base-ui/react/input'
import { type VariantProps, cva } from 'class-variance-authority'
import type * as React from 'react'

const inputVariants = cva(
  'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input bg-m3-surface-container-low aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex h-11 w-full min-w-0 rounded-full border px-4 py-1 text-base shadow-xs transition-[color,box-shadow,border] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: null,
        outline: 'hover:border-ring focus-visible:border-ring',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type InputProps = React.ComponentProps<typeof InputPrimitive> &
  VariantProps<typeof inputVariants>

function Input({ variant, className, type, ...props }: InputProps) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Input }
export type { InputProps }
