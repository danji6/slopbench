import { ScrollFrameLoop, followDelta } from './scroll-animation'
import type { ScrollTarget } from './scroll-target'

type FollowOptions = {
  target(): ScrollTarget | null
  running(): boolean
  conditional(): boolean
  settleCondition(): boolean
  canIdle(): boolean
  release(): void
  immediate(): boolean
  rate: number
  speed: number
}

/** Runs follow animation while the scroll policy retains ownership. */
export class FollowAnimation {
  private loop = new ScrollFrameLoop()
  private lastTime = 0

  constructor(private options: FollowOptions) {}

  start() {
    this.lastTime = 0
    this.loop.start(this.tick)
  }

  cancel() {
    this.loop.cancel()
  }

  private idle() {
    if (!this.options.conditional() && !this.options.canIdle()) {
      this.options.release()
      return
    }
    this.lastTime = 0
    this.loop.next()
  }

  private tick = () => {
    const target = this.options.target()
    if (!target || !this.options.running()) {
      this.options.release()
      return
    }
    const bottom = Math.max(
      0,
      target.getScrollHeight() - target.getClientHeight(),
    )
    const current = target.getScrollTop()
    const distance = bottom - current
    if (distance <= 0) {
      if (this.options.settleCondition()) return
      this.idle()
      return
    }
    this.advance(target, current, distance)
    if (this.options.settleCondition()) return
    if (target.getScrollTop() >= bottom - 0.5) {
      target.setScrollTop(bottom)
      this.idle()
      return
    }
    this.loop.next()
  }

  private advance(target: ScrollTarget, current: number, distance: number) {
    const now = performance.now()
    const dt = Math.min(this.lastTime ? now - this.lastTime : 16, 50)
    this.lastTime = now
    const delta = followDelta(
      distance,
      target.getClientHeight(),
      dt,
      this.options.rate,
      this.options.speed,
      this.options.immediate() || document.visibilityState === 'hidden',
    )
    target.setScrollTop(current + delta)
  }
}
