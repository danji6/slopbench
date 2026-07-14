import { cn } from '@/lib/utils'

type ProgressCircleProps = {
  value: number
  max: number
  size?: number
  strokeWidth?: number
  className?: string
  trackClassName?: string
  fillClassName?: string
}

function ProgressCircle({
  value,
  max,
  size = 20,
  strokeWidth = 2,
  className,
  trackClassName,
  fillClassName,
}: ProgressCircleProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const percentage = max > 0 ? Math.min(value / max, 1) : 0
  const strokeDashoffset = circumference - percentage * circumference

  return (
    <svg
      data-slot="progress-circle"
      width={size}
      height={size}
      className={cn('-rotate-90', className)}
      aria-label={`Progress: ${Math.round(percentage * 100)}%`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        className={cn('stroke-input/60', trackClassName)}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        className={cn(
          'stroke-primary transition-all duration-300 ease-out',
          fillClassName,
        )}
      />
    </svg>
  )
}

export { ProgressCircle }
export type { ProgressCircleProps }
