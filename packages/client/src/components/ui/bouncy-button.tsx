
import { cn, isTouchDevice } from '@/lib/utils'
import { type VariantProps, cva } from 'class-variance-authority'
import type { TargetAndTransition, Transition } from 'motion/react'

import { buttonVariants } from './button'
import { RippleButton, type RippleButtonProps } from './ripple-button'

export const bouncyButtonVariants = cva('transition-[box-shadow,border]', {
  variants: {
    variant: {
      primary: 'hover:bg-primary',
      secondary: '',
      surface: '',
      destructive: 'hover:bg-destructive',
      outline: '',
      ghost: 'transition-none!',
      link: '',
    },
  },
})

export type BouncyButtonProps = Omit<
  RippleButtonProps,
  'whileTap' | 'whileHover' | 'transition'
> &
  VariantProps<typeof bouncyButtonVariants> &
  VariantProps<typeof buttonVariants> & {
    whileTap?: TargetAndTransition
    whileHover?: TargetAndTransition
    transition?: Transition
  }

export function BouncyButton({
  className,
  variant,
  size,
  type = 'button',
  whileTap = {},
  whileHover = {},
  transition = {},
  ...props
}: BouncyButtonProps) {
  const isTouch = isTouchDevice()

  return (
    <RippleButton
      variant={variant}
      size={size}
      type={type}
      whileTap={{ scale: isTouch ? 0.9 : 0.98, ...whileTap }}
      whileHover={{ scale: 1.07, ...whileHover }}
      transition={{
        type: 'spring',
        stiffness: isTouch ? 500 : 400,
        damping: 15,
        ...transition,
      }}
      className={cn(
        buttonVariants({ variant, size }),
        bouncyButtonVariants({ variant, className }),
      )}
      {...props}
    />
  )
}
