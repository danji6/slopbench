import { cn } from '@/lib/utils'
import { motion, useAnimationFrame } from 'motion/react'
import { useRef } from 'react'

const START_ANGLE = -Math.PI / 2
const TWO_PI = Math.PI * 2
const SAMPLE_STEP = Math.PI / 120

const RAMP_DURATION = 2.4
const HOLD_DURATION = 0.5
const COMPLETE_DURATION = 0.35
const FAKE_DURATION = RAMP_DURATION + HOLD_DURATION + COMPLETE_DURATION
const STALL_PROGRESS = 0.95

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1)
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function rampProgress(time: number) {
  const t = Math.min(time, RAMP_DURATION) / RAMP_DURATION
  return STALL_PROGRESS * (1 - Math.exp(-4.5 * t))
}

function fakeProgress(elapsed: number) {
  if (elapsed < RAMP_DURATION + HOLD_DURATION) return rampProgress(elapsed)
  const stalled = rampProgress(RAMP_DURATION)
  const completing =
    (elapsed - RAMP_DURATION - HOLD_DURATION) / COMPLETE_DURATION
  return stalled + (1 - stalled) * smoothstep(0, 1, completing)
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

type WavyProgressCircleProps = {
  /** Progress from 0 to 1. Omit to play fake loading. */
  value?: number
  size?: number
  strokeWidth?: number
  /** Peak wave amplitude in px. */
  amplitude?: number
  /** Number of wave crests around the full circle. */
  waves?: number
  /** Wave travel speed in radians per second. */
  speed?: number
  className?: string
  trackClassName?: string
  fillClassName?: string
}

function WavyProgressCircle({
  value,
  size = 40,
  strokeWidth = 4,
  amplitude = 2,
  waves = 8,
  speed = Math.PI,
  className,
  trackClassName,
  fillClassName,
}: WavyProgressCircleProps) {
  const fillRef = useRef<SVGPathElement>(null)
  const trackRef = useRef<SVGPathElement>(null)
  const startTimeRef = useRef<number | null>(null)
  const fakeStartRef = useRef<number | null>(null)
  const settledRef = useRef(false)

  const center = size / 2
  const radius = (size - strokeWidth) / 2 - amplitude
  const gapAngle = (strokeWidth * 2) / radius

  useAnimationFrame((time) => {
    if (settledRef.current && value === undefined) return

    startTimeRef.current ??= time
    const elapsed = (time - startTimeRef.current) / 1000

    let fakeElapsed = 0
    let progress: number
    if (value !== undefined) {
      // Replay from the start if control is handed back
      fakeStartRef.current = null
      progress = clamp01(value)
    } else {
      fakeStartRef.current ??= time
      fakeElapsed = (time - fakeStartRef.current) / 1000
      progress = fakeProgress(fakeElapsed)
    }

    const amp = amplitude * waveEnvelope(progress)
    const phase = -elapsed * speed
    const fillEnd = START_ANGLE + Math.max(progress * TWO_PI, 0.02)
    fillRef.current?.setAttribute(
      'd',
      arcPath(center, radius, amp, waves, phase, START_ANGLE, fillEnd),
    )

    const trackFrom = fillEnd + gapAngle
    const trackTo = START_ANGLE + TWO_PI - gapAngle
    trackRef.current?.setAttribute(
      'd',
      trackTo - trackFrom > 0.05
        ? arcPath(center, radius, 0, waves, phase, trackFrom, trackTo)
        : '',
    )

    settledRef.current = value === undefined && fakeElapsed >= FAKE_DURATION
  })

  return (
    <motion.svg
      data-slot="wavy-progress-circle"
      width={size}
      height={size}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={
        value !== undefined ? Math.round(clamp01(value) * 100) : undefined
      }
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

export { WavyProgressCircle }
export type { WavyProgressCircleProps }
