import { cn } from '@/lib/utils'
import { useRender } from '@base-ui/react/use-render'
import { type VariantProps, cva } from 'class-variance-authority'
import type * as React from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'surface'
  | 'stealth'
  | 'destructive'
  | 'outline'
  | 'input'
  | 'ghost'
  | 'link'
  | 'plain'
  | null
  | undefined

export const buttonVariants = cva(
  "focus-visible:ring-ring aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/90 shadow-xs',
        tertiary:
          'bg-m3-tertiary text-m3-on-tertiary hover:bg-m3-tertiary/90 shadow-xs',
        surface:
          'text-m3-on-surface hover:bg-m3-surface-container-high bg-m3-surface-container',
        stealth: 'text-m3-on-surface hover:bg-m3-surface-container-high',
        destructive:
          'bg-m3-error-container hover:bg-m3-error-container/90 focus-visible:ring-destructive/50 text-m3-on-error-container shadow-xs',
        outline:
          'bg-m3-surface-container text-m3-on-surface border-input hover:ring-ring hover:border-ring border shadow-xs',
        input:
          'bg-m3-surface-container-low text-m3-on-surface border-input hover:bg-m3-surface-container border shadow-xs',
        ghost:
          'text-m3-on-surface hover:bg-m3-secondary hover:text-m3-on-secondary',
        link: 'text-primary underline',
        plain: 'text-m3-on-surface',
      },
      size: {
        default: 'h-10 px-4 py-2 has-[>svg]:px-4',
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-12 px-5',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  render?: useRender.RenderProp
}

export function Button({
  className,
  variant,
  size,
  type = 'button',
  render = <button type={type} />,
  ...props
}: ButtonProps) {
  return useRender({
    render,
    props: {
      'data-slot': 'button',
      className: cn(buttonVariants({ variant, size, className })),
      ...props,
    },
  })
}
