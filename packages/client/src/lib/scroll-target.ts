import { scrollDebug, scrollDebugSource } from './scroll-debug'

/**
 * Used to keep track of {@link WindowScrollTarget}'s scrolling operations and
 * allow us to distinguish them from programmatic scrolling from other libraries
 * like virtua or motion so we can suppress those.
 */
export let internalScrollWrites = 0

const withInternalScroll = (fn: () => void) => {
  internalScrollWrites++
  try {
    fn()
  } finally {
    internalScrollWrites--
  }
}

/** Scroll target abstraction for {@link Scroller}. */
export interface ScrollTarget {
  getScrollTop(): number
  setScrollTop(value: number): void
  getScrollHeight(): number
  getClientHeight(): number
  scrollTo(options: ScrollToOptions): void
  /** Rect of the scroll viewport, used to position elements relative to it. */
  getViewportRect(): DOMRect
  setOverflowAnchor(value: string): void
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void
  /** Root for an IntersectionObserver watching content in this scroller. */
  intersectionRoot(): Element | null
}

/** Scrolls a regular overflow container. */
export class ElementScrollTarget implements ScrollTarget {
  constructor(private readonly el: HTMLElement) {}

  getScrollTop() {
    return this.el.scrollTop
  }
  setScrollTop(value: number) {
    this.el.scrollTop = value
  }
  getScrollHeight() {
    return this.el.scrollHeight
  }
  getClientHeight() {
    return this.el.clientHeight
  }
  scrollTo(options: ScrollToOptions) {
    this.el.scrollTo(options)
  }
  getViewportRect() {
    return this.el.getBoundingClientRect()
  }
  setOverflowAnchor(value: string) {
    this.el.style.overflowAnchor = value
  }
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) {
    this.el.addEventListener(type, listener, options)
  }
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ) {
    this.el.removeEventListener(type, listener, options)
  }
  intersectionRoot() {
    return this.el
  }
}

/** Scrolls the document via the window. */
export class WindowScrollTarget implements ScrollTarget {
  getScrollTop() {
    return window.scrollY
  }
  setScrollTop(value: number) {
    withInternalScroll(() => window.scrollTo(0, value))
  }
  getScrollHeight() {
    return document.documentElement.scrollHeight
  }
  getClientHeight() {
    return window.innerHeight
  }
  scrollTo(options: ScrollToOptions) {
    withInternalScroll(() => window.scrollTo(options))
  }
  getViewportRect() {
    return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
  }
  setOverflowAnchor(value: string) {
    document.documentElement.style.overflowAnchor = value
    document.body.style.overflowAnchor = value
  }
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) {
    window.addEventListener(type, listener, options)
  }
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ) {
    window.removeEventListener(type, listener, options)
  }
  intersectionRoot() {
    return null
  }
}

let windowScrollPatched = false

/**
 * Suppresses window scrolling when one of the suppressors returns true.
 * Notes:
 * - This may break in future versions of virtua/motion
 * - Programmatic navigation won't work while this operates (use the scroller for that)
 */
export function patchWindowScroll(suppressors: Iterable<() => boolean>) {
  if (windowScrollPatched || typeof window === 'undefined') return
  windowScrollPatched = true
  for (const name of ['scrollTo', 'scroll', 'scrollBy'] as const) {
    const original = (window[name] as (...a: unknown[]) => unknown).bind(window)
    ;(window as unknown as Record<string, unknown>)[name] = (
      ...args: unknown[]
    ) => {
      const before = window.scrollY
      const internal = internalScrollWrites > 0
      if (!internal) {
        for (const suppress of suppressors) {
          if (suppress()) {
            scrollDebug('write.suppressed', () => ({
              name,
              args,
              source: scrollDebugSource(),
            }))
            return
          }
        }
      }
      const result = original(...args)
      scrollDebug('write.applied', () => ({
        name,
        args,
        internal,
        before,
        after: window.scrollY,
        source: scrollDebugSource(),
      }))
      return result
    }
  }
}
