import { cn } from '@/lib/utils'
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'
import type * as React from 'react'

function ScrollArea({
  className,
  viewportClassName,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          'focus-visible:ring-ring size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-1 focus-visible:outline-1',
          viewportClassName,
        )}
      >
        <ScrollAreaPrimitive.Content>{children}</ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px opacity-0 transition-[colors,opacity] delay-300 duration-150 select-none data-hovering:opacity-100 data-hovering:delay-0 data-hovering:duration-75 data-scrolling:opacity-100 data-scrolling:delay-0 data-scrolling:duration-75',
        orientation === 'vertical' &&
          'h-full w-1.5 border-l border-l-transparent',
        orientation === 'horizontal' &&
          'h-1.5 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="bg-ring relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
