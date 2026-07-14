import { cn } from '@/lib/utils'

export function FadingGradient({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'from-background bg-scrim-to-t pointer-events-none absolute right-0 bottom-0 left-0 h-8 rounded-b-xl',
        className,
      )}
      aria-hidden="true"
    />
  )
}
