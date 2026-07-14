import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="skeleton"
      className={cn(
        'bg-m3-surface-container-highest block animate-pulse rounded-xl',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
