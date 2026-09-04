const DURATION = /^(?:\d+(?:\.\d*)?|\.\d+)\s*([smh])?$/i

const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
} as const

/** Parses a non negative duration, treating a plain number as seconds. */
export function parseDurationMs(value: string): number {
  const input = value.trim()
  const match = DURATION.exec(input)
  if (!match) throw new Error(`Invalid duration: ${value}`)

  const amount = Number.parseFloat(input)
  const unit = (match[1]?.toLowerCase() ?? 's') as keyof typeof UNIT_MS
  const duration = amount * UNIT_MS[unit]
  const deadline = Date.now() + duration

  if (
    !Number.isFinite(duration) ||
    duration < 0 ||
    !Number.isSafeInteger(Math.round(duration)) ||
    !Number.isFinite(deadline)
  ) {
    throw new Error(`Invalid duration: ${value}`)
  }

  return Math.round(duration)
}
