import { cn } from '@/lib/utils'
import { mergeProps } from '@base-ui/react/merge-props'
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { useState } from 'react'

import { RippleButton, type RippleButtonProps } from './ripple-button'

export function Toggle({
  className,
  ...props
}: React.ComponentProps<typeof TogglePrimitive>) {
  const [isActive, setActive] = useState(false)

  return (
    <TogglePrimitive
      data-slot="toggle"
      render={(renderProps, { pressed }) => {
        const hPadding = `calc(var(--spacing) * ${isActive ? 5 : 4})`
        const borderRadius = pressed || isActive ? '12px' : '20px'

        return (
          <RippleButton
            variant="surface"
            rippleVariant={pressed ? 'primary' : 'surface'}
            className={cn(
              "focus-visible:border-ring focus-visible:ring-ring aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex items-center justify-center gap-2 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
              'active:bg-m3-surface-container data-pressed:bg-m3-primary data-pressed:text-m3-on-primary',
              'h-11 rounded-[unset] px-[unset] py-2',
              pressed ? 'transition-none' : 'transition-colors',
              className,
            )}
            style={{
              borderRadius,
              paddingLeft: hPadding,
              paddingRight: hPadding,
            }}
            animate={{
              borderRadius,
              paddingLeft: hPadding,
              paddingRight: hPadding,
            }}
            transition={{
              type: 'spring',
              damping: 30,
              stiffness: 600,
            }}
            {...(renderProps as RippleButtonProps)}
          />
        )
      }}
      {...mergeProps(props, {
        onPointerDown: () => setActive(true),
        onPointerUp: () => setActive(false),
        onPointerLeave: () => setActive(false),
      })}
    />
  )
}
