import { cn } from '@/lib/utils'

export function ContextDivider({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'text-muted-foreground/50 flex w-full items-center gap-3 text-xs',
        className,
      )}
    >
      <div className="h-px flex-1 bg-current opacity-30" />
      <span>{label}</span>
      <div className="h-px flex-1 bg-current opacity-30" />
    </div>
  )
}
