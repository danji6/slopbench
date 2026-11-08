import { cn } from '@/lib/utils'
import { cubicBezier, easeInOut, motion, useAnimationFrame } from 'motion/react'
import { useRef } from 'react'

const START_ANGLE = -Math.PI / 2
const TWO_PI = Math.PI * 2
const SAMPLE_STEP = Math.PI / 120

const SWEEP_DURATION = 3
const SPIN_INTERVAL = 1.5
const SPIN_DURATION = 0.7
const MIN_SWEEP = 0.12 * TWO_PI
const MAX_SWEEP = 0.8 * TWO_PI
const MIN_TRACK_SWEEP = 0.05
const easeSweep = cubicBezier(0.2, 0, 0, 1)

type WavyProgressCircleProps = {
  /** Progress from 0 to 1. Omit for an indeterminate indicator. */
  value?: number
  /** Show the indeterminate animation even when a value is supplied. */
  indeterminate?: boolean
  size?: number
  strokeWidth?: number
  /** Peak wave amplitude in px. */
  amplitude?: number
  /** Number of wave crests around the full circle. */
  waves?: number
  /** Wave phase drift in radians per second. Defaults to 0 for indeterminate. */
  speed?: number
  className?: string
  trackClassName?: string
  fillClassName?: string
}

function WavyProgressCircle({
  value,
  indeterminate = false,
  size = 40,
  strokeWidth: requestedStrokeWidth,
  amplitude: requestedAmplitude,
  waves = 8,
  speed,
  className,
  trackClassName,
  fillClassName,
}: WavyProgressCircleProps) {
  const fillRef = useRef<SVGPathElement>(null)
  const trackRef = useRef<SVGPathElement>(null)

  const progress = indeterminate || value === undefined ? undefined : clamp01(value) // prettier-ignore
  const isIndeterminate = progress === undefined
  const waveSpeed = speed ?? (isIndeterminate ? 0 : Math.PI)
  const scale = isIndeterminate ? Math.min(1, size / 32) : 1
  const strokeWidth = requestedStrokeWidth ?? 4 * scale
  const amplitude = requestedAmplitude ?? 2 * scale
  const center = size / 2
  const radius = (size - strokeWidth) / 2 - amplitude
  const gapAngle = (strokeWidth * 2) / radius

  useAnimationFrame((time) => {
    const elapsed = time / 1000
    const { start, end } = isIndeterminate
      ? indeterminateArc(elapsed, gapAngle)
      : {
          start: START_ANGLE,
          end: START_ANGLE + Math.max(progress * TWO_PI, 0.02),
        }
    const amp = isIndeterminate ? amplitude : amplitude * waveEnvelope(progress)
    // Center a crest in the shortest arc and carry it with the rotation.
    const minimumArcMidpoint = start + MIN_SWEEP / 2
    const phaseOffset = isIndeterminate
      ? Math.PI / 2 - waves * minimumArcMidpoint
      : 0
    const phase = phaseOffset - elapsed * waveSpeed
    fillRef.current?.setAttribute(
      'd',
      arcPath(center, radius, amp, waves, phase, start, end),
    )

    const trackFrom = end + gapAngle
    const trackTo = start + TWO_PI - gapAngle
    trackRef.current?.setAttribute(
      'd',
      trackTo - trackFrom > MIN_TRACK_SWEEP
        ? arcPath(center, radius, 0, waves, phase, trackFrom, trackTo)
        : '',
    )
  })

  return (
    <motion.svg
      data-slot="wavy-progress-circle"
      width={size}
      height={size}
      role="progressbar"
      aria-label={isIndeterminate ? 'Loading' : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isIndeterminate ? undefined : Math.round(progress * 100)}
      className={className}
      initial={{ opacity: 0, scale: 0.65 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        opacity: { duration: 0.18, ease: 'easeOut' },
        scale: { type: 'spring', stiffness: 520, damping: 24, mass: 0.7 },
      }}
    >
      <path
        ref={trackRef}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        className={cn('stroke-input/60', trackClassName)}
      />
      <path
        ref={fillRef}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('stroke-primary', fillClassName)}
      />
    </motion.svg>
  )
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1)
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Grow and retreat the leading edge over a six-second rotation cycle. */
function indeterminateArc(elapsed: number, gapAngle: number) {
  const cycleTime = elapsed % (SWEEP_DURATION * 2)
  const spinTime = cycleTime % SPIN_INTERVAL
  const spins =
    Math.floor(cycleTime / SPIN_INTERVAL) +
    easeInOut(clamp01(spinTime / SPIN_DURATION))
  const start = START_ANGLE + cycleTime * Math.PI + spins * (Math.PI / 2)

  const growth = easeSweep(clamp01(cycleTime / SWEEP_DURATION))
  const retreat = easeSweep(
    clamp01((cycleTime - SWEEP_DURATION) / SWEEP_DURATION),
  )
  const availableSweep = TWO_PI - 2 * (gapAngle + MIN_TRACK_SWEEP)
  const maxSweep = Math.max(MIN_SWEEP, Math.min(MAX_SWEEP, availableSweep))
  const sweep = MIN_SWEEP + (maxSweep - MIN_SWEEP) * (growth - retreat)
  return { start, end: start + sweep }
}

function waveEnvelope(progress: number) {
  return smoothstep(0.03, 0.25, progress) * (1 - smoothstep(0.96, 1, progress))
}

function arcPath(
  center: number,
  radius: number,
  amplitude: number,
  waves: number,
  phase: number,
  from: number,
  to: number,
) {
  const points: string[] = []
  for (let angle = from; ; angle += SAMPLE_STEP) {
    const a = Math.min(angle, to)
    const r = radius + amplitude * Math.sin(waves * a + phase)
    const x = (center + r * Math.cos(a)).toFixed(2)
    const y = (center + r * Math.sin(a)).toFixed(2)
    points.push(`${x} ${y}`)
    if (a >= to) break
  }
  return `M ${points.join(' L ')}`
}

export { WavyProgressCircle }
export type { WavyProgressCircleProps }
