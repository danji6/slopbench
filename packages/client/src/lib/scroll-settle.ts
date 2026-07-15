const STABLE_FRAMES = 2
const MAX_FRAMES = 40

/**
 * Track the target's height until it settles. Useful to prevent false positives
 * in animated components.
 *
 * @returns a canceller that stops the loop.
 */
export function trackHeightSettle(
  onChange: () => void,
  target: HTMLElement = document.documentElement,
  onDone?: () => void,
): () => void {
  let raf = 0
  let frames = 0
  let stable = 0
  let lastHeight = -1
  let done = false

  // Fires exactly once, whether the loop settles naturally or is cancelled
  const finish = () => {
    if (done) return
    done = true
    onDone?.()
  }

  const tick = () => {
    const height = target.scrollHeight
    if (height === lastHeight) {
      stable++
    } else {
      stable = 0
      lastHeight = height
    }
    onChange()
    if (stable < STABLE_FRAMES && frames++ < MAX_FRAMES) {
      raf = requestAnimationFrame(tick)
    } else {
      raf = 0
      finish()
    }
  }

  raf = requestAnimationFrame(tick)

  return () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    finish()
  }
}

const CONVERGE_TOLERANCE = 1.5
const CONVERGE_STABLE_FRAMES = 3
const CONVERGE_MAX_MS = 2500

type TrackOptions = {
  tolerance?: number
  stableFrames?: number
  maxMs?: number
  /** Fires once when the loop finishes, whether it settles or is cancelled. */
  onDone?: () => void
}

/**
 * Track `step` until the returned distance is stable for a few frames.
 *
 * @returns a canceller that stops the loop.
 */
export function trackUntilSettled(
  step: () => number | null,
  {
    tolerance = CONVERGE_TOLERANCE,
    stableFrames = CONVERGE_STABLE_FRAMES,
    maxMs = CONVERGE_MAX_MS,
    onDone,
  }: TrackOptions = {},
): () => void {
  let raf = 0
  let stable = 0
  let done = false
  const start = performance.now()

  const finish = () => {
    if (done) return
    done = true
    onDone?.()
  }

  const tick = () => {
    const remaining = step()
    if (remaining !== null && Math.abs(remaining) <= tolerance) {
      stable++
    } else {
      stable = 0
    }
    if (stable < stableFrames && performance.now() - start < maxMs) {
      raf = requestAnimationFrame(tick)
    } else {
      raf = 0
      finish()
    }
  }

  raf = requestAnimationFrame(tick)

  return () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    finish()
  }
}
