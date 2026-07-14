import { cn } from '@/lib/utils'
import { type VariantProps, cva } from 'class-variance-authority'

import { buttonVariants } from './button'
import { RippleButton, type RippleButtonProps } from './ripple-button'

export const liquidButtonVariants = cva(
  'shadow-none [background:linear-gradient(var(--liquid-button-color)_0_0)_no-repeat_50%_100%/100%_var(--liquid-button-fill,0)] [transition:background_0.3s,color_0.3s] hover:[--liquid-button-fill:100%]',
  {
    variants: {
      variant: {
        primary:
          'text-m3-primary hover:text-m3-on-primary bg-background! [--liquid-button-color:var(--primary)]',
        outline:
          'hover:border-input bg-background text-m3-primary hover:text-m3-on-primary border-input border [--liquid-button-color:var(--primary)] hover:bg-[unset] hover:ring-0',
        secondary:
          'text-m3-primary hover:text-m3-on-secondary bg-background! [--liquid-button-color:var(--secondary)]',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
)

export interface LiquidButtonProps extends RippleButtonProps {
  variant?: VariantProps<typeof liquidButtonVariants>['variant']
}

export function LiquidButton({
  className,
  variant,
  size,
  ...props
}: LiquidButtonProps) {
  return (
    <RippleButton
      className={cn(
        buttonVariants({ variant, size }),
        liquidButtonVariants({ variant, className }),
      )}
      {...props}
    />
  )
}
