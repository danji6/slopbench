import { cn } from '@/lib'

export function EmptyMessage({
  style,
  className,
}: {
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <div
      className={cn('text-muted-foreground mx-auto text-center', className)}
      style={style}
    >
      Send a message to start a new session
    </div>
  )
}
