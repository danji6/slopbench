
import { type RippleOptions, useRipples } from '@/hooks/ripples'
import { cn } from '@/lib/utils'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { type HTMLMotionProps, motion } from 'framer-motion'
import { useRef } from 'react'

import { type ButtonProps, buttonVariants } from './button'

export type RippleButtonProps = ButtonProps &
  HTMLMotionProps<'button'> &
  RippleOptions

export function RippleButton({
  children,
  className,
  variant,
  rippleVariant,
  size,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  rippleDuration,
  fadeDuration,
  type = 'button',
  render = <motion.button type={type} />,
  ...props
}: RippleButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)

  const ripples = useRipples(buttonRef, {
    variant,
    rippleVariant,
    rippleDuration,
    fadeDuration,
  })

  return useRender({
    render,
    ref: buttonRef,
    props: mergeProps(props, {
      suppressHydrationWarning: true,
      className: cn(
        buttonVariants({ variant, size }),
        'relative isolate overflow-hidden',
        className,
      ),
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      children: (
        <>
          {ripples}
          {children}
        </>
      ),
    }),
  })
}
