import {
  type ScrollTarget,
  WindowScrollTarget,
  patchWindowScroll,
} from './scroll-target'

/** Time to ease through the remaining distance. Lower = snappier. */
const DEFAULT_FOLLOW_TIME_CONSTANT_MS = 100

/**
 * Distance before an instant snap to the bottom. The exponential
 * ease only approaches asymptotically, so we snap the final sub-pixel.
 */
const SETTLE_EPSILON_PX = 0.5

/**
 * Upper bound on follow velocity. Caps a frame scroll step so that
 * large gaps glide smoothly instead of snapping to the bottom.
 */
const DEFAULT_MAX_FOLLOW_SPEED_PX_PER_MS = 1.2

/** Snap through gaps this large instead of gliding. */
const FOLLOW_SNAP_VIEWPORT_MULTIPLE = 2

/** Max time a frame can take before the follow needs to catch up. */
const MAX_FRAME_MS = 50

/** How close to the bottom (px) before autoscroll should trigger again. */
const FOLLOW_RESUME_DISTANCE = 80

/** Which events should always cancel a follow. */
const SCROLL_CANCEL_EVENTS = ['wheel', 'touchmove'] as const

/** Used to suppress external programmatic scrolls during an ongoing follow operation. */
const scrollSuppressors = new Set<() => boolean>()

const SCROLL_DEBUG = false
const dbg = (...args: unknown[]) => {
  if (SCROLL_DEBUG)
    console.log(`[scroller +${Math.round(performance.now())}ms]`, ...args)
}

export interface AutoScrollerOptions {
  enabled?: boolean

  /** Time to ease through the remaining distance. Lower = snappier. */
  followTimeConstantMs?: number

  /**
   * Upper bound on follow velocity. Caps a frame scroll step so
   * that large gaps glide smoothly instead of snapping to the bottom.
   */
  maxFollowSpeedPxPerMs?: number

  /**
   * Invoked when the stop condition is met.
   */
  onSettle?: () => void

  /**
   * Invoked when the user scrolls up while auto-following is active.
   */
  onFollowRelease?: () => void

  /**
   * Distance (px) reserved at the bottom of the viewport to prevent
   * early locking.
   */
  bottomInset?: number
}

export class Scroller {
  private target: ScrollTarget | null = null
  private contentEl: HTMLElement | null = null
  private sentinel: HTMLDivElement | null = null
  private followK: number
  private maxFollowSpeed: number
  private loopToken = 0
  private _lastBlockReason = ''
  private _lastIdleLog = 0
  private scrollLock = false
  private rafId: number | null = null
  private hasScrolled = false
  private isFollowing = false
  private lastTime = 0
  private observer: IntersectionObserver | null = null
  private cancelListeners: (() => void) | null = null
  private _enabled = true
  private _ready = false
  private _bottomInset = 0
  private _shiftInProgress = false
  private _suppressAutoFollow = false
  private _stopCondition: (() => boolean) | null = null
  private _overflowAnchorLocked = false
  private _immediate = false
  private _manualScrollActive = false
  private _userScrollIntent: 'up' | 'down' | null = null
  private mutationObserver: MutationObserver | null = null
  private resizeObserver: ResizeObserver | null = null
  private scrollListener: (() => void) | null = null
  onSettle: (() => void) | null = null
  onFollowRelease: (() => void) | null = null

  constructor(options: AutoScrollerOptions = {}) {
    this.followK =
      1 / (options.followTimeConstantMs ?? DEFAULT_FOLLOW_TIME_CONSTANT_MS)
    this.maxFollowSpeed =
      options.maxFollowSpeedPxPerMs ?? DEFAULT_MAX_FOLLOW_SPEED_PX_PER_MS
    this._enabled = options.enabled ?? true
    this.onSettle = options.onSettle ?? null
    this.onFollowRelease = options.onFollowRelease ?? null
    this._bottomInset = Math.max(0, Math.round(options.bottomInset ?? 0))
  }

  setBottomInset(px: number) {
    const value = Math.max(0, Math.round(px))
    if (this._bottomInset === value) return
    this._bottomInset = value
    if (this.observer && this.sentinel) {
      this.observer.disconnect()
      this.observer = this._createIntersectionObserver()
      this.observer.observe(this.sentinel)
    }
  }

  get enabled() {
    return this._enabled
  }

  set enabled(value: boolean) {
    if (this._enabled === value) return
    dbg(`SET enabled=${value} (was following=${this.isFollowing})`)
    this._enabled = value
    if (!value) {
      this.isFollowing = false
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId)
        this.rafId = null
      }
    }
    this._updateOverflowAnchor()
  }

  set shiftInProgress(value: boolean) {
    const wasActive = this._shiftInProgress
    if (wasActive !== value)
      dbg(`SET shiftInProgress=${value} (was following=${this.isFollowing})`)
    this._shiftInProgress = value
    if (value) {
      this.isFollowing = false
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId)
        this.rafId = null
      }
      this._stopCondition = null
      this._updateOverflowAnchor()
    } else if (wasActive) {
      this._updateOverflowAnchor()
      // Suppress auto-follow for one frame so DOM/resize events
      // from layout changes are ignored
      this._suppressAutoFollow = true
      requestAnimationFrame(() => {
        this._suppressAutoFollow = false
      })
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

  private _stopFollowing(lock: boolean) {
    dbg(`stopFollowing lock=${lock}`)
    this.isFollowing = false
    this.scrollLock = lock
    this._updateOverflowAnchor()

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    if (this.cancelListeners) {
      this.cancelListeners()
      this.cancelListeners = null
    }
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

    this.isFollowing = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    const viewportRect = target.getViewportRect()
    const elementRect = element.getBoundingClientRect()
    const elementScrollTop =
      target.getScrollTop() + (elementRect.top - viewportRect.top)
    const targetScrollTop = Math.max(0, elementScrollTop - topPadding)

    this._userScrollIntent = 'up'
    this.scrollLock = false
    this._updateOverflowAnchor()
    target.scrollTo({ top: targetScrollTop, behavior: 'instant' })
  }

  private _beginFollow(target: ScrollTarget, onCancel?: () => void) {
    const stopFollow = () => {
      onCancel?.()
      this.scrollLock = true
      this.isFollowing = false
      this._updateOverflowAnchor()
    }

    SCROLL_CANCEL_EVENTS.forEach((event) => {
      target.addEventListener(event, stopFollow, {
        passive: true,
        capture: true,
      })
    })

    this.cancelListeners = () => {
      SCROLL_CANCEL_EVENTS.forEach((event) => {
        target.removeEventListener(event, stopFollow, { capture: true })
      })
    }

    const token = ++this.loopToken
    this._updateOverflowAnchor()
    dbg(`beginFollow token=${token} stop=${this._stopCondition !== null}`)
    this.rafId = requestAnimationFrame(() => this.followAnimation(token))
  }

  private _settleStopCondition() {
    this._stopCondition = null
    this.isFollowing = false
    this.scrollLock = true
    this._updateOverflowAnchor()
    if (this.cancelListeners) {
      this.cancelListeners()
      this.cancelListeners = null
    }
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

  // Keeps following and owning the scroll when idle at the bottom
  private _idleAtBottom(token: number) {
    if (
      !this._enabled ||
      this.scrollLock ||
      this._manualScrollActive ||
      this._userScrollIntent === 'up'
    ) {
      dbg(
        `idleRelease enabled=${this._enabled} lock=${this.scrollLock} manual=${this._manualScrollActive} intent=${this._userScrollIntent}`,
      )
      this.isFollowing = false
      this._updateOverflowAnchor()
      return
    }
    this.lastTime = 0
    this.rafId = requestAnimationFrame(() => this.followAnimation(token))
  }

  private followAnimation = (token: number) => {
    // A newer loop (or a stop) superseded this one
    if (token !== this.loopToken) return

    const target = this.target
    if (!target || !this.isFollowing) {
      if (target) dbg(`bail !isFollowing tok=${token}`)
      this.isFollowing = false
      this._updateOverflowAnchor()
      return
    }

    const to = Math.max(0, target.getScrollHeight() - target.getClientHeight())
    const current = target.getScrollTop()
    const distance = to - current

    if (distance <= 0) {
      const now = performance.now()
      if (now - this._lastIdleLog > 500) {
        this._lastIdleLog = now
        dbg(
          `idle tok=${token} cur=${Math.round(current)} to=${Math.round(to)} scrollH=${Math.round(target.getScrollHeight())} clientH=${Math.round(target.getClientHeight())}`,
        )
      }

      if (this._stopCondition !== null) {
        if (this._stopCondition()) {
          this._settleStopCondition()
          return
        }
        this.lastTime = 0
        this.rafId = requestAnimationFrame(() => this.followAnimation(token))
        return
      }

      this._idleAtBottom(token)
      return
    }

    const now = performance.now()
    const rawDt = this.lastTime ? now - this.lastTime : 16
    const dt = Math.min(rawDt, MAX_FRAME_MS)
    this.lastTime = now

    dbg(
      `frame tok=${token} cur=${Math.round(current)} to=${Math.round(to)} dist=${Math.round(distance)}`,
    )

    // Ease a fixed fraction of the remaining gap each frame
    let delta = distance * (1 - Math.exp(-this.followK * dt))

    const snapThreshold =
      target.getClientHeight() * FOLLOW_SNAP_VIEWPORT_MULTIPLE
    if (
      this._immediate ||
      document.visibilityState === 'hidden' ||
      distance > snapThreshold
    ) {
      // Skip the ease and snap
      delta = distance
    } else {
      // Cap velocity to prevent snapping on large gaps
      const maxStep = this.maxFollowSpeed * dt
      if (delta > maxStep) delta = maxStep
      if (delta < 1) delta = Math.min(distance, 1)
    }

    target.setScrollTop(current + delta)

    if (this._stopCondition?.()) {
      this._settleStopCondition()
      return
    }

    if (target.getScrollTop() >= to - SETTLE_EPSILON_PX) {
      target.setScrollTop(to)
      if (this._stopCondition !== null) {
        // Into-view: at the bottom but condition not met yet.
        this.lastTime = 0
        this.rafId = requestAnimationFrame(() => this.followAnimation(token))
        return
      }
      // Follow: keep the loop alive to smooth-follow more content
      this._idleAtBottom(token)
      return
    }

    this.rafId = requestAnimationFrame(() => this.followAnimation(token))
  }

  lockScroll = () => {
    if (
      this.scrollLock ||
      !this._enabled ||
      this.isFollowing ||
      this._manualScrollActive ||
      this._userScrollIntent === 'up'
    ) {
      const reason = `lock=${this.scrollLock} enabled=${this._enabled} following=${this.isFollowing} manual=${this._manualScrollActive} intent=${this._userScrollIntent}`
      if (reason !== this._lastBlockReason) {
        this._lastBlockReason = reason
        dbg(`lockScroll BLOCKED ${reason}`)
      }
      return
    }
    this._lastBlockReason = ''

    const target = this.target
    if (!target) return

    this._overflowAnchorLocked = false
    this.isFollowing = true
    this.lastTime = 0

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
    }

    if (this.cancelListeners) {
      this.cancelListeners()
      this.cancelListeners = null
    }

    this._beginFollow(target)
  }

  unlockScroll = (shouldScroll?: boolean) => {
    dbg(`unlockScroll shouldScroll=${shouldScroll}`)
    if (this._stopCondition !== null) return
    this._userScrollIntent = null
    this.isFollowing = false

    this._overflowAnchorLocked = false
    this._updateOverflowAnchor()

    if (this._enabled) {
      this.scrollLock = false
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    if (this.cancelListeners) {
      this.cancelListeners()
      this.cancelListeners = null
    }

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
    dbg(`pauseFollow direction=${direction}`)
    this._userScrollIntent = direction === 1 ? 'down' : 'up'
    this._stopCondition = null
    this._stopFollowing(true)
  }

  holdPosition = () => {
    dbg('holdPosition')
    this._userScrollIntent = 'up'
    this._stopCondition = null
    this.scrollLock = true
    this.isFollowing = false
    this._updateOverflowAnchor()

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    if (this.cancelListeners) {
      this.cancelListeners()
      this.cancelListeners = null
    }
  }

  scrollToBottom = (immediate = false) => {
    dbg(`scrollToBottom immediate=${immediate}`)
    const target = this.target
    if (!target) return

    this._overflowAnchorLocked = false
    this._userScrollIntent = null
    this.scrollLock = false
    this.isFollowing = !immediate
    this.lastTime = 0
    this._updateOverflowAnchor()

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    if (this.cancelListeners) {
      this.cancelListeners()
      this.cancelListeners = null
    }

    if (immediate) {
      target.setScrollTop(
        Math.max(0, target.getScrollHeight() - target.getClientHeight()),
      )
      return
    }

    this._beginFollow(target)
  }

  scrollUntilCondition = (stopCondition: () => boolean) => {
    dbg('scrollUntilCondition')
    const target = this.target
    if (!target) return

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
    }

    if (this.cancelListeners) {
      this.cancelListeners()
      this.cancelListeners = null
    }

    this._overflowAnchorLocked = true
    this._updateOverflowAnchor()

    this._userScrollIntent = null
    this.scrollLock = false
    this.isFollowing = true
    this.lastTime = 0
    this._stopCondition = stopCondition

    this._beginFollow(target, () => {
      this._stopCondition = null
    })
  }

  private _createIntersectionObserver() {
    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      const entry = entries[0]
      if (!entry) return

      if (entry.isIntersecting) {
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
      }
    }

    return new IntersectionObserver(handleIntersection, {
      root: this.target?.intersectionRoot() ?? null,
      rootMargin: `0px 0px ${-this._bottomInset}px 0px`,
      threshold: 0,
    })
  }

  init() {
    if (!this._ready) return
    if (this.observer) return
    const sentinel = this.sentinel
    const target = this.target
    const contentEl = this.contentEl
    if (!sentinel || !target || !contentEl) return

    if (target instanceof WindowScrollTarget) {
      patchWindowScroll(scrollSuppressors)
      scrollSuppressors.add(this._ownsScroll)
    }

    this.observer = this._createIntersectionObserver()
    this.observer.observe(sentinel)

    queueMicrotask(() => {
      if (!this.hasScrolled) {
        this.scrollToBottomImmediate()
      }
    })

    this.mutationObserver = new MutationObserver(() => {
      if (!this.hasScrolled) {
        this.scrollToBottomImmediate()
        return
      }
      this._unlockIfContentFits()
      if (this._suppressAutoFollow) return
      if (
        this._enabled &&
        !this._manualScrollActive &&
        !this.scrollLock &&
        !this.isFollowing &&
        !this._shiftInProgress
      ) {
        this.lockScroll()
      }
    })

    this.mutationObserver.observe(contentEl, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    let lastScrollHeight = target.getScrollHeight()
    this.resizeObserver = new ResizeObserver(() => {
      const newScrollHeight = target.getScrollHeight()
      if (newScrollHeight === lastScrollHeight) return
      lastScrollHeight = newScrollHeight

      if (!this.hasScrolled) {
        this.scrollToBottomImmediate()
        return
      }
      this._unlockIfContentFits()
      if (this._suppressAutoFollow) return
      if (
        this._enabled &&
        !this._manualScrollActive &&
        !this.scrollLock &&
        !this.isFollowing &&
        !this._shiftInProgress
      ) {
        this.lockScroll()
      }
    })

    this.resizeObserver.observe(contentEl)
    Array.from(contentEl.children).forEach((child) => {
      if (child !== sentinel) {
        this.resizeObserver?.observe(child)
      }
    })

    let prevScrollTop = target.getScrollTop()
    let prevScrollHeight = target.getScrollHeight()
    let prevClientHeight = target.getClientHeight()
    const handleScroll = () => {
      const t = this.target
      if (!t) return

      const currentScrollTop = t.getScrollTop()
      const currentScrollHeight = t.getScrollHeight()
      const currentClientHeight = t.getClientHeight()
      const heightShrank = currentScrollHeight < prevScrollHeight
      const viewportChanged = currentClientHeight !== prevClientHeight
      const scrollingDown = currentScrollTop > prevScrollTop
      const scrollingUp = !heightShrank && currentScrollTop < prevScrollTop

      prevScrollTop = currentScrollTop
      prevScrollHeight = currentScrollHeight
      prevClientHeight = currentClientHeight

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
        dbg('handleScroll: release (following + scrollingUp)')
        this.onFollowRelease?.()
        this._stopFollowing(true)
        return
      }

      const distanceFromBottom =
        currentScrollHeight - currentScrollTop - t.getClientHeight()
      const nearBottom = distanceFromBottom < FOLLOW_RESUME_DISTANCE

      if (!this.isFollowing && !this.scrollLock && scrollingUp && !nearBottom) {
        this.onFollowRelease?.()
        this.scrollLock = true
        return
      }

      if (this.isFollowing || !this.scrollLock) return
      if (nearBottom && scrollingDown && this._userScrollIntent !== 'up') {
        this.scrollLock = false
      }
    }

    target.addEventListener('scroll', handleScroll, { passive: true })

    const isTouch = (event: Event) =>
      (event as PointerEvent).pointerType === 'touch'

    const startManualScroll = (event: Event) => {
      if (isTouch(event)) return
      this._manualScrollActive = true
      this._stopCondition = null
      this._stopFollowing(true)
    }

    const stopManualScroll = (event: Event) => {
      if (isTouch(event) || !this._manualScrollActive) return
      this._manualScrollActive = false
      const t = this.target
      if (!t || !this._enabled) return
      const distanceFromBottom =
        t.getScrollHeight() - t.getScrollTop() - t.getClientHeight()
      if (distanceFromBottom < FOLLOW_RESUME_DISTANCE) {
        this.scrollLock = false
      }
    }

    let touchY = 0
    const releaseOnUserScrollUp = () => {
      if (this._enabled) this.onFollowRelease?.()
    }
    const onWheel = (event: Event) => {
      const deltaY = (event as WheelEvent).deltaY
      if (deltaY < 0) {
        this._userScrollIntent = 'up'
        releaseOnUserScrollUp()
      } else if (deltaY > 0) {
        this._userScrollIntent = 'down'
      }
    }
    const onTouchStart = (event: Event) => {
      touchY = (event as TouchEvent).touches[0]?.clientY ?? 0
    }
    const onTouchMove = (event: Event) => {
      const y = (event as TouchEvent).touches[0]?.clientY ?? 0
      if (y - touchY > 0) {
        this._userScrollIntent = 'up'
        releaseOnUserScrollUp()
      } else if (y - touchY < 0) {
        this._userScrollIntent = 'down'
      }
      touchY = y
    }

    target.addEventListener('pointerdown', startManualScroll, {
      passive: true,
      capture: true,
    })
    window.addEventListener('pointerup', stopManualScroll, { capture: true })
    window.addEventListener('pointercancel', stopManualScroll, {
      capture: true,
    })
    target.addEventListener('wheel', onWheel, { passive: true })
    target.addEventListener('touchstart', onTouchStart, { passive: true })
    target.addEventListener('touchmove', onTouchMove, { passive: true })

    this.scrollListener = () => {
      target.removeEventListener('scroll', handleScroll)
      target.removeEventListener('pointerdown', startManualScroll, {
        capture: true,
      })
      window.removeEventListener('pointerup', stopManualScroll, {
        capture: true,
      })
      window.removeEventListener('pointercancel', stopManualScroll, {
        capture: true,
      })
      target.removeEventListener('wheel', onWheel)
      target.removeEventListener('touchstart', onTouchStart)
      target.removeEventListener('touchmove', onTouchMove)
    }
  }

  dispose() {
    this._ready = false
    scrollSuppressors.delete(this._ownsScroll)
    this._stopCondition = null
    this.isFollowing = false
    this._shiftInProgress = false
    this._manualScrollActive = false
    this._userScrollIntent = null
    this._overflowAnchorLocked = false
    this._immediate = false
    this._updateOverflowAnchor()
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
    }
    this.scrollListener?.()
    this.scrollListener = null
    this.observer?.disconnect()
    this.observer = null
    this.mutationObserver?.disconnect()
    this.mutationObserver = null
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.target = null
    this.contentEl = null
    this.sentinel = null
  }
}
