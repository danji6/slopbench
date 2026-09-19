/** Owns animation frames and prevents canceled callbacks from restarting a loop. */
export class ScrollFrameLoop {
  private frame: number | null = null
  private generation = 0
  private callback: (() => void) | null = null

  start(callback: () => void) {
    this.cancel()
    this.callback = callback
    this.next()
  }

  next() {
    const generation = this.generation
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      if (generation === this.generation) this.callback?.()
    })
  }

  cancel() {
    this.generation++
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    this.callback = null
  }
}

/** Calculates the existing exponential follow step, capped at the configured speed. */
export function followDelta(
  distance: number,
  viewport: number,
  dt: number,
  rate: number,
  speed: number,
  immediate: boolean,
): number {
  if (immediate || distance > viewport * 2) return distance
  const delta = Math.min(distance * (1 - Math.exp(-rate * dt)), speed * dt)
  return delta < 1 ? Math.min(distance, 1) : delta
}
