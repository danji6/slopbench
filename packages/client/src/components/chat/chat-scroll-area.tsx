import { cn } from '@/lib/utils'

export type ChatScrollAreaProps = React.ComponentProps<'div'> & {
  scrollRef?: React.Ref<HTMLDivElement>
  scrollerClassName?: string
  bottomPadding?: number
  mode?: 'element' | 'window'
}

export function ChatScrollArea({
  scrollRef,
  className,
  scrollerClassName,
  bottomPadding,
  mode = 'element',
  children,
  ...rest
}: ChatScrollAreaProps) {
  if (mode === 'window') {
    return (
      <div
        ref={scrollRef}
        className={cn('relative isolate flex w-full flex-col', className)}
        style={{ paddingBottom: bottomPadding }}
        {...rest}
      >
        {children}
      </div>
    )
  }

  return (
    <div
      className={cn('relative isolate flex h-full min-h-0 flex-col', className)}
      {...rest}
    >
      <div
        ref={scrollRef}
        className={cn(
          'flex h-full flex-col overflow-x-hidden overflow-y-auto',
          scrollerClassName,
        )}
        style={{ paddingBottom: bottomPadding }}
      >
        {children}
      </div>
    </div>
  )
}
