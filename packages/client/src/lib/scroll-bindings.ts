import {
  type ScrollMovement,
  observeScrollContent,
  observeScrollInput,
  observeScrollMovement,
} from './scroll-observers'
import {
  type ScrollTarget,
  WindowScrollTarget,
  patchWindowScroll,
} from './scroll-target'

const suppressors = new Set<() => boolean>()

type ScrollCallbacks = {
  ownsScroll(): boolean
  intersect(): void
  content(): void
  movement(value: ScrollMovement): void
  start(): void
  end(): void
  direction(value: 1 | -1): void
}

/** Owns DOM subscriptions and removes them together when the scroller detaches. */
export class ScrollBindings {
  private intersection: IntersectionObserver | null = null
  private cleanups: Array<() => void>

  constructor(
    private target: ScrollTarget,
    content: HTMLElement,
    private sentinel: HTMLElement,
    bottomInset: number,
    private callbacks: ScrollCallbacks,
  ) {
    if (target instanceof WindowScrollTarget) {
      patchWindowScroll(suppressors)
      suppressors.add(callbacks.ownsScroll)
    }
    this.setBottomInset(bottomInset)
    this.cleanups = [
      observeScrollContent(target, content, sentinel, callbacks.content),
      observeScrollMovement(target, callbacks.movement),
      observeScrollInput(target, callbacks),
    ]
  }

  setBottomInset(px: number) {
    this.intersection?.disconnect()
    this.intersection = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) this.callbacks.intersect()
      },
      {
        root: this.target.intersectionRoot(),
        rootMargin: `0px 0px ${-px}px 0px`,
        threshold: 0,
      },
    )
    this.intersection.observe(this.sentinel)
  }

  dispose() {
    suppressors.delete(this.callbacks.ownsScroll)
    this.intersection?.disconnect()
    this.intersection = null
    for (const cleanup of this.cleanups.splice(0)) cleanup()
  }
}
