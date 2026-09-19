import { ScrollBindings } from './scroll-bindings'
import { ScrollCoordinator } from './scroll-coordinator'
import { FollowAnimation } from './scroll-follow'
import type { AutoScrollerOptions } from './scroll-options'
import type { ScrollTarget } from './scroll-target'

export type { AutoScrollerOptions } from './scroll-options'

/** Time to ease through the remaining distance. Lower = snappier. */
const DEFAULT_FOLLOW_TIME_CONSTANT_MS = 100

/**
 * Upper bound on follow velocity. Caps a frame scroll step so that
 * large gaps glide smoothly instead of snapping to the bottom.
 */
const DEFAULT_MAX_FOLLOW_SPEED_PX_PER_MS = 1.2

/** How long auto-follow stays suppressed after a layout shift ends. */
const LAYOUT_SHIFT_SETTLE_MS = 250

/** How close to the bottom (px) before autoscroll should trigger again. */
const FOLLOW_RESUME_DISTANCE = 80

/** Bottom tolerance for preserving the tail when the dock or keyboard grows. */
const BOTTOM_ANCHOR_TOLERANCE = 20

export class Scroller {
  private target: ScrollTarget | null = null
  private contentEl: HTMLElement | null = null
  private sentinel: HTMLDivElement | null = null
  readonly coordinator: ScrollCoordinator
  private animation: FollowAnimation
  private scrollLock = false
  private hasScrolled = false
  private isFollowing = false
  private bindings: ScrollBindings | null = null
  private _enabled = true
  private _ready = false
  private _bottomInset = 0
  private _shiftInProgress = false
  private _suppressAutoFollow = false
  private _suppressTimer: ReturnType<typeof setTimeout> | null = null
  private _stopCondition: (() => boolean) | null = null
  private _overflowAnchorLocked = false
  private _immediate = false
  private _manualScrollActive = false
  private _userScrollIntent: 'up' | 'down' | null = null
  onSettle: (() => void) | null = null
  onFollowRelease: (() => void) | null = null
  onPositionChange: ((autoScrolling: boolean) => void) | null = null

  constructor(options: AutoScrollerOptions = {}) {
    this.animation = new FollowAnimation({
      target: () => this.target,
      running: () => this.isFollowing,
      conditional: () => this._stopCondition !== null,
      settleCondition: () => {
        if (!this._stopCondition?.()) return false
        this._settleStopCondition()
        return true
      },
      canIdle: () =>
        this._enabled &&
        !this.scrollLock &&
        !this._manualScrollActive &&
        this._userScrollIntent !== 'up',
      release: () => {
        this.isFollowing = false
        this._updateOverflowAnchor()
      },
      immediate: () => this._immediate,
      rate:
        1 / (options.followTimeConstantMs ?? DEFAULT_FOLLOW_TIME_CONSTANT_MS),
      speed:
        options.maxFollowSpeedPxPerMs ?? DEFAULT_MAX_FOLLOW_SPEED_PX_PER_MS,
    })
    this.coordinator = options.coordinator ?? new ScrollCoordinator()
    this._enabled = options.enabled ?? true
    this.onSettle = options.onSettle ?? null
    this.onFollowRelease = options.onFollowRelease ?? null
    this.onPositionChange = options.onPositionChange ?? null
    this._bottomInset = Math.max(0, Math.round(options.bottomInset ?? 0))
  }

  get autoScrolling() {
    return this.isFollowing
  }

  setBottomInset(px: number) {
    const value = Math.max(0, Math.round(px))
    if (this._bottomInset === value) return
    this._compensateBottomInset(value - this._bottomInset)
    this._bottomInset = value
    this.bindings?.setBottomInset(value)
  }

  /** Preserves a visible tail after its bottom padding has grown in the DOM. */
  private _compensateBottomInset(delta: number) {
    const target = this.target
    if (
      !target ||
      !this._ready ||
      delta <= 0 ||
      this._manualScrollActive ||
      this._shiftInProgress ||
      this._userScrollIntent === 'up'
    )
      return

    const bottom = Math.max(
      0,
      target.getScrollHeight() - target.getClientHeight(),
    )
    const distance = bottom - target.getScrollTop()
    // Subtract the added padding to recover the distance before the resize
    if (distance > 0 && distance - delta < BOTTOM_ANCHOR_TOLERANCE) {
      target.setScrollTop(bottom)
      this.onPositionChange?.(this.autoScrolling)
    }
  }

  get enabled() {
    return this._enabled
  }

  set enabled(value: boolean) {
    if (this._enabled === value) return
    this._enabled = value
    if (!value) {
      if (this.coordinator.kind === 'follow') this.coordinator.cancel()
      this.isFollowing = false
      this.animation.cancel()
    }
    this._updateOverflowAnchor()
  }

  set shiftInProgress(value: boolean) {
    const wasActive = this._shiftInProgress
    this._shiftInProgress = value
    if (value) {
      this.isFollowing = false
      this.animation.cancel()
      this._stopCondition = null
      this._updateOverflowAnchor()
    } else if (wasActive) {
      this._updateOverflowAnchor()
      // Suppress auto-follow until the shifted layout has finished animating
      this._suppressAutoFollow = true
      if (this._suppressTimer !== null) clearTimeout(this._suppressTimer)
      this._suppressTimer = setTimeout(() => {
        this._suppressTimer = null
        this._suppressAutoFollow = false
      }, LAYOUT_SHIFT_SETTLE_MS)
    }
  }

  private _updateOverflowAnchor() {
    if (!this.target) return
    // Disable native scroll anchoring during follow to prevent interferences
    this.target.setOverflowAnchor(
      this._shiftInProgress || this._overflowAnchorLocked || this._ownsScroll()
        ? 'none'
        : '',
    )
  }

  private _unlockIfContentFits() {
    const target = this.target
    if (!target) return
    if (
      this.scrollLock &&
      target.getScrollHeight() <= target.getClientHeight()
    ) {
      this.scrollLock = false
      this._updateOverflowAnchor()
    }
  }

  /** Resumes following once the user scrolls back to the bottom. */
  private _resumeAtBottom() {
    const target = this.target
    if (!target || !this._enabled) return
    if (this.isFollowing || this._stopCondition !== null) return

    const distanceFromBottom =
      target.getScrollHeight() -
      target.getScrollTop() -
      target.getClientHeight()
    if (distanceFromBottom >= FOLLOW_RESUME_DISTANCE) return

    this._userScrollIntent = null
    this.coordinator.resumeFollow()
    this.scrollLock = false
    this.lockScroll()
  }

  private _stopFollowing(lock: boolean) {
    if (this.coordinator.kind === 'follow') this.coordinator.cancel()
    // Explicit positioning/interaction ends initialization even if the bottom
    // sentinel has not been observed yet (e.g. during a thinking stream)
    this.hasScrolled = true
    this.isFollowing = false
    this.scrollLock = lock
    this._updateOverflowAnchor()

    this.animation.cancel()
  }

  setElements(
    target: ScrollTarget,
    contentEl: HTMLElement,
    sentinel: HTMLDivElement,
  ) {
    this.target = target
    this.contentEl = contentEl
    this.sentinel = sentinel
    this.init()
  }

  setReady(value: boolean) {
    if (this._ready === value) return
    this._ready = value
    if (value) this.init()
  }

  /** While immediate, snaps to the bottom on each frame instead of easing */
  setImmediate(value: boolean) {
    this._immediate = value
  }

  get sentinelRef() {
    return this.sentinel
  }

  scrollToBottomImmediate = () => {
    if (!this.coordinator.canFollow()) return
    const target = this.target
    if (!target) return

    const to = Math.max(0, target.getScrollHeight() - target.getClientHeight())
    if (to > 0) {
      target.setScrollTop(to)
    }
  }

  scrollToElementTop(element: HTMLElement, topPadding = 16) {
    const target = this.target
    if (!target) return

    const operation = this.coordinator.begin('navigate')
    if (!operation) return
    this.hasScrolled = true

    this.isFollowing = false
    this.animation.cancel()

    const viewportRect = target.getViewportRect()
    const elementRect = element.getBoundingClientRect()
    const elementScrollTop =
      target.getScrollTop() + (elementRect.top - viewportRect.top)
    const targetScrollTop = Math.max(0, elementScrollTop - topPadding)

    this._userScrollIntent = 'up'
    this.scrollLock = false
    this._updateOverflowAnchor()
    target.scrollTo({ top: targetScrollTop, behavior: 'instant' })
    operation.finish()
  }

  private _beginFollow() {
    const stopCondition = this._stopCondition
    const operation = this.coordinator.begin('follow')
    if (!operation) {
      this._stopFollowing(true)
      return
    }
    this._stopCondition = stopCondition
    operation.onCancel(() => {
      this._stopCondition = null
      this._stopFollowing(true)
    })
    this.isFollowing = true
    this.scrollLock = false
    this._updateOverflowAnchor()
    this.animation.start()
  }

  private _settleStopCondition() {
    if (this.coordinator.kind === 'follow') this.coordinator.cancel()
    this._stopCondition = null
    this.isFollowing = false
    this.scrollLock = true
    this._updateOverflowAnchor()
    this.onSettle?.()
  }

  // True while an eased follow is actively running. Used to suppress external
  // programmatic scrolls.
  private _ownsScroll = () =>
    this.isFollowing &&
    this._enabled &&
    this.hasScrolled &&
    !this.scrollLock &&
    this._userScrollIntent !== 'up' &&
    !this._manualScrollActive &&
    !this._shiftInProgress

  lockScroll = () => {
    if (
      this.scrollLock ||
      !this._enabled ||
      this.isFollowing ||
      this._manualScrollActive ||
      this._userScrollIntent === 'up'
    ) {
      return
    }

    const target = this.target
    if (!target) return

    this._overflowAnchorLocked = false
    this.isFollowing = true

    this.animation.cancel()

    this._beginFollow()
  }

  unlockScroll = (shouldScroll?: boolean) => {
    if (this.coordinator.kind && this.coordinator.kind !== 'follow') return
    this.coordinator.resumeFollow()
    if (!this.coordinator.canFollow()) return
    if (this._stopCondition !== null) return
    this._userScrollIntent = null
    this.isFollowing = false

    this._overflowAnchorLocked = false
    this._updateOverflowAnchor()

    if (this._enabled) {
      this.scrollLock = false
    }

    this.animation.cancel()

    if (shouldScroll) {
      queueMicrotask(() => this.lockScroll())
      return
    }

    if (!this.hasScrolled) {
      this.scrollToBottomImmediate()
    } else if (this._enabled) {
      queueMicrotask(() => this.lockScroll())
    }
  }

  // Stops following and records the user's intent for later resume.
  // Unlike unlockScroll, this doesn't queue a new follow operation.
  pauseFollow = (direction: 1 | -1) => {
    this.coordinator.interrupt()
    this._userScrollIntent = direction === 1 ? 'down' : 'up'
    this._stopCondition = null
    this._stopFollowing(true)
  }

  holdPosition = () => {
    this._userScrollIntent = 'up'
    this._stopCondition = null
    this._stopFollowing(true)
  }

  scrollToBottom = (immediate = false) => {
    const target = this.target
    if (!target) return

    this._overflowAnchorLocked = false
    this._userScrollIntent = null
    this.scrollLock = false
    this.isFollowing = !immediate
    this._updateOverflowAnchor()

    this.animation.cancel()

    if (immediate) {
      target.setScrollTop(
        Math.max(0, target.getScrollHeight() - target.getClientHeight()),
      )
      return
    }

    this._beginFollow()
  }

  scrollUntilCondition = (stopCondition: () => boolean) => {
    const target = this.target
    if (!target) return

    this.animation.cancel()

    this._overflowAnchorLocked = true
    this._updateOverflowAnchor()

    this._userScrollIntent = null
    this.scrollLock = false
    this.isFollowing = true
    this._stopCondition = stopCondition

    this._beginFollow()
  }

  init() {
    if (!this._ready || this.bindings) return

    const { sentinel, target, contentEl } = this
    if (!sentinel || !target || !contentEl) return

    this.bindings = new ScrollBindings(
      target,
      contentEl,
      sentinel,
      this._bottomInset,
      {
        ownsScroll: this._ownsScroll,
        intersect: () => {
          this.hasScrolled = true
          if (
            this._enabled &&
            !this._manualScrollActive &&
            this._userScrollIntent !== 'up'
          ) {
            this.scrollLock = false
            this._updateOverflowAnchor()
            queueMicrotask(() => this.lockScroll())
          }
        },
        content: () => {
          if (!this.hasScrolled) {
            this.scrollToBottomImmediate()
            return
          }
          this._unlockIfContentFits()
          if (this._suppressAutoFollow) {
            this.onPositionChange?.(this.autoScrolling)
            return
          }
          if (
            this._enabled &&
            !this._manualScrollActive &&
            !this.scrollLock &&
            !this.isFollowing &&
            !this._shiftInProgress
          ) {
            this.lockScroll()
          }
          this.onPositionChange?.(this.autoScrolling)
        },
        movement: ({
          scrollingUp,
          scrollingDown,
          heightShrank,
          viewportChanged,
        }) => {
          const t = this.target
          if (!t) return
          if (!this._enabled) return

          this._unlockIfContentFits()

          if (this._manualScrollActive) {
            if (scrollingUp) this._userScrollIntent = 'up'
            else if (scrollingDown) this._userScrollIntent = 'down'
            if (scrollingUp && this._stopCondition === null) {
              this.onFollowRelease?.()
            }
            return
          }

          // Ignore up detection caused by shrinking content or a viewport resize
          if (heightShrank || viewportChanged) return

          if (this.isFollowing && scrollingUp && this._stopCondition === null) {
            this.onFollowRelease?.()
            this._stopFollowing(true)
            return
          }

          const distanceFromBottom =
            t.getScrollHeight() - t.getScrollTop() - t.getClientHeight()
          const nearBottom = distanceFromBottom < FOLLOW_RESUME_DISTANCE

          if (
            !this.isFollowing &&
            !this.scrollLock &&
            scrollingUp &&
            !nearBottom
          ) {
            this.onFollowRelease?.()
            this.scrollLock = true
            return
          }

          if (this.isFollowing) return

          // Resume on any downward arrival near the bottom
          if (nearBottom && scrollingDown) {
            this._resumeAtBottom()
          }
        },
        start: () => {
          this.coordinator.interrupt()
          this._manualScrollActive = true
          this._stopCondition = null
          this._stopFollowing(true)
        },
        end: () => {
          if (!this._manualScrollActive) return
          this._manualScrollActive = false
          this._resumeAtBottom()
        },
        direction: (direction) => {
          this.coordinator.interrupt()
          if (direction === -1) {
            this.pauseFollow(-1)
            if (this._enabled) this.onFollowRelease?.()
          } else this._userScrollIntent = 'down'
        },
      },
    )
    queueMicrotask(() => {
      if (this._ready && !this.hasScrolled) this.scrollToBottomImmediate()
    })
  }

  dispose() {
    this.coordinator.cancel()
    this._ready = false
    if (this._suppressTimer !== null) {
      clearTimeout(this._suppressTimer)
      this._suppressTimer = null
    }
    this._suppressAutoFollow = false
    this._stopCondition = null
    this.isFollowing = false
    this._shiftInProgress = false
    this._manualScrollActive = false
    this._userScrollIntent = null
    this._overflowAnchorLocked = false
    this._immediate = false
    this._updateOverflowAnchor()
    this.animation.cancel()
    this.bindings?.dispose()
    this.bindings = null
    this.target = null
    this.contentEl = null
    this.sentinel = null
  }
}
