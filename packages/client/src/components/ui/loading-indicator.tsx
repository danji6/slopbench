import { WavyProgressCircle } from './wavy-progress-circle'

export type LoadingIndicatorProps = {
  size?: number
  className?: string
}

export function LoadingIndicator({
  size = 48,
  className,
}: LoadingIndicatorProps) {
  return <WavyProgressCircle indeterminate size={size} className={className} />
}
