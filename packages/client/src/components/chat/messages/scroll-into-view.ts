import { useEffect, useRef } from 'react'

const EXTRA_PADDING = 48

type ScrollIntoViewParams = {
  /** When this turns true, the block is scrolled into view. */
  active: boolean
  /**
   * Which edge of the block to bring into view: 'end' reveals the bottom
   * above the dock, 'start' aligns the top below the nav (for long blocks
   * that should be read from the beginning).
   */
  align?: 'end' | 'start'
  behavior?: ScrollBehavior
  blockRef: React.RefObject<HTMLElement | null>
  scrollRef?: React.RefObject<HTMLElement | null>
  onBeforeScroll?: () => void
  bottomPadding?: number
  topPadding?: number
}

/** Scrolls a block into view once layout settles. */
export function useScrollIntoView({
  active,
  align = 'end',
  behavior = 'smooth',
  blockRef,
  scrollRef,
  onBeforeScroll,
  bottomPadding = 0,
  topPadding = 0,
}: ScrollIntoViewParams) {
  const prevActive = useRef(active)
  const paddingRef = useRef({ bottomPadding, topPadding })
  const onBeforeScrollRef = useRef(onBeforeScroll)

  useEffect(() => {
    paddingRef.current = { bottomPadding, topPadding }
    onBeforeScrollRef.current = onBeforeScroll
  })

  useEffect(() => {
    const wasActive = prevActive.current
    prevActive.current = active

    if (!active || wasActive) return

    const scrollEl = scrollRef?.current
    const blockEl = blockRef.current
    if (!scrollEl || !blockEl) return

    const isDocScroll = scrollEl === document.documentElement

    const getScrollHeight = () =>
      isDocScroll
        ? document.documentElement.scrollHeight
        : scrollEl.scrollHeight

    let rafId = 0
    let frames = 0
    let stableFrames = 0
    let prevScrollHeight = -1
    let cancelled = false

    const cancel = () => {
      cancelled = true
    }

    const scrollBy = (top: number) => {
      onBeforeScrollRef.current?.()
      const opts: ScrollToOptions = { top, behavior }
      if (isDocScroll) window.scrollBy(opts)
      else scrollEl.scrollBy(opts)
    }

    const reveal = () => {
      const { bottomPadding, topPadding } = paddingRef.current
      const spacingPx =
        parseFloat(getComputedStyle(scrollEl).getPropertyValue('--spacing')) *
          16 || 4
      const topPaddingPx = topPadding * spacingPx
      const scrollRect = isDocScroll
        ? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
        : scrollEl.getBoundingClientRect()
      const blockRect = blockEl.getBoundingClientRect()
      const visibleBottom = scrollRect.bottom - bottomPadding - EXTRA_PADDING

      if (align === 'start') {
        const targetTop = scrollRect.top + topPaddingPx + 16
        // Leave the block alone while its start is already readable
        if (blockRect.top >= targetTop - 1 && blockRect.top <= visibleBottom) {
          return
        }
        scrollBy(blockRect.top - targetTop)
        return
      }

      if (blockRect.bottom <= visibleBottom) return

      const overflowAmount = blockRect.bottom - visibleBottom + 16
      const maxScroll = Math.max(
        0,
        blockRect.top - scrollRect.top - topPaddingPx - 16,
      )
      const scrollAmount = Math.min(overflowAmount, maxScroll)
      if (scrollAmount > 0) scrollBy(scrollAmount)
    }

    const waitForSettle = () => {
      if (cancelled) return cleanup()

      const scrollHeight = getScrollHeight()
      stableFrames = scrollHeight === prevScrollHeight ? stableFrames + 1 : 0
      prevScrollHeight = scrollHeight

      if (stableFrames >= 2 || ++frames >= 60) {
        reveal()
        cleanup()
      } else {
        rafId = requestAnimationFrame(waitForSettle)
      }
    }

    const cleanup = () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchmove', cancel)
    }

    window.addEventListener('wheel', cancel, { passive: true })
    window.addEventListener('touchmove', cancel, { passive: true })
    rafId = requestAnimationFrame(waitForSettle)

    return cleanup
  }, [active, align, behavior, blockRef, scrollRef])
}
