import { cn } from '@/lib/utils'
import { Input as InputPrimitive } from '@base-ui/react/input'
import { type VariantProps, cva } from 'class-variance-authority'
import type * as React from 'react'

const inputVariants = cva(
  'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input bg-m3-surface-container-low aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex w-full min-w-0 rounded-full border px-4 py-1 shadow-xs transition-[color,box-shadow,border] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'h-11 text-base',
        sm: 'h-9 text-sm',
      },
      variant: {
        default: null,
        outline: 'hover:border-ring focus-visible:border-ring',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type InputProps = Omit<React.ComponentProps<typeof InputPrimitive>, 'size'> &
  VariantProps<typeof inputVariants>

function Input({ variant, size, className, type, ...props }: InputProps) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Input }
export type { InputProps }
