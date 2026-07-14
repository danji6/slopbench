import { cn } from '@/lib/utils'

export function MediaContainer({
  className,
  ...props
}: React.ComponentProps<'figure'>) {
  return (
    <figure
      className={cn(
        'mx-auto w-fit overflow-hidden rounded-2xl border',
        className,
      )}
      {...props}
    />
  )
}
