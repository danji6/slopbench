import { cn } from '@/lib/utils'
import React from 'react'

export type PillProps = React.ComponentProps<'div'> & {
  direction?: 'horizontal' | 'vertical'
  innerClassName?: string
}

export function Pill({
  className,
  direction = 'horizontal',
  innerClassName,
  children,
  ...props
}: PillProps) {
  return (
    <div
      className={cn(
        'bg-background/50 border-input/20 w-fit rounded-full border p-1 shadow-xs backdrop-blur-md',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'bg-m3-surface-container/40 flex items-center rounded-full p-1 backdrop-blur-md',
          direction === 'vertical' && 'flex-col',
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
