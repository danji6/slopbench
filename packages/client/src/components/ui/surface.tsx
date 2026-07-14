import { cn } from '@/lib/utils'

export function Surface({
  className,
  ...props
}: { className?: string } & React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="surface"
      className={cn(
        'bg-m3-surface-container-low rounded-2xl border px-4 py-2',
        className,
      )}
      {...props}
    />
  )
}
