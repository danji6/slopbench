import { cn } from '@/lib/utils'
import { motion } from 'motion/react'

export type PulsingDotsProps = {
  count?: number
  className?: string
  dotClassName?: string
}

export function PulsingDots({
  count = 3,
  className,
  dotClassName,
}: PulsingDotsProps) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex items-center gap-1', className)}
    >
      {Array.from({ length: count }, (_, i) => (
        <motion.span
          key={i}
          className={cn(
            'bg-muted-foreground/60 size-2 shrink-0 rounded-full',
            dotClassName,
          )}
          animate={{ opacity: [0.7, 0.9, 0.7], scale: [1, 1.25, 1] }}
          transition={{
            duration: 0.6,
            repeat: Number.POSITIVE_INFINITY,
            delay: i * 0.2,
            ease: 'easeInOut',
          }}
        />
      ))}
    </span>
  )
}
