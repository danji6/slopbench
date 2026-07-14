import { cn } from '@/lib/utils'

export function Background({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      style={{ background: 'var(--radial)' }}
      className={cn('min-h-dvh w-full', className)}
    >
      {children}
    </div>
  )
}
