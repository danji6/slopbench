import { useMessageList } from '@/components/chat/messages/message-list/message-list-context'
import { useEffect, useRef } from 'react'

const EXTRA_PADDING = 48

type ScrollIntoViewParams = {
  /** When this turns true, the block is scrolled into view. */
  active: boolean
  /**
   * Also reveal when the block first mounts already active. Needed when the
   * content that hosts the reveal mounts after `active` is already true.
   */
  revealOnMount?: boolean
  /**
   * Which edge of the block to bring into view: 'end' reveals the bottom
   * above the dock, 'start' aligns the top below the nav (for long blocks
   * that should be read from the beginning).
   */
  align?: 'end' | 'start'
  behavior?: ScrollBehavior
  blockRef: React.RefObject<HTMLElement | null>
  revealComposerMessageId?: string
  /** Measures the end of a block whose body spans separate virtual rows. */
  getBlockBottom?: (block: HTMLElement) => number | undefined
}

/** Scrolls a block into view once layout settles. */
export function useScrollIntoView({
  active,
  revealOnMount = false,
  align = 'end',
  behavior = 'smooth',
  blockRef,
  revealComposerMessageId,
  getBlockBottom,
}: ScrollIntoViewParams) {
  const messageList = useMessageList()
  const coordinator = messageList?.scrollCoordinator
  const scrollRef = messageList?.scrollRef
  const prevActive = useRef(revealOnMount ? false : active)
  const listRef = useRef(messageList)

  useEffect(() => {
    listRef.current = messageList
  })

  useEffect(() => {
    const wasActive = prevActive.current
    prevActive.current = active

    if (!active || wasActive) return

    const scrollEl = scrollRef?.current
    const blockEl = blockRef.current
    if (!scrollEl || !blockEl) return

    const finishComposerReveal = revealComposerMessageId
      ? listRef.current?.holdComposerForReveal?.(revealComposerMessageId)
      : undefined

    // Stop following if start-aligned
    if (align === 'start') listRef.current?.releaseFollow()

    // The layout hold owns the viewport until the expansion settles.
    const layoutIsCurrent =
      coordinator?.kind === 'layout' ? coordinator.checkpoint() : null
    const isDocScroll = scrollEl === document.documentElement

    const getScrollHeight = () =>
      isDocScroll
        ? document.documentElement.scrollHeight
        : scrollEl.scrollHeight

    const getBlockBounds = () => {
      const rect = blockEl.getBoundingClientRect()
      return { top: rect.top, bottom: getBlockBottom?.(blockEl) ?? rect.bottom }
    }

    let rafId = 0
    let frames = 0
    let stableFrames = 0
    let prevScrollHeight = -1
    let prevBlockHeight = -1
    let cancelled = false
    let finished = false
    let scrolled = false

    const cancel = () => {
      cancelled = true
    }

    const scrollBy = (top: number) => {
      scrolled = true
      listRef.current?.releaseFollow()
      const opts: ScrollToOptions = { top, behavior }
      if (isDocScroll) window.scrollBy(opts)
      else scrollEl.scrollBy(opts)
    }

    const reveal = () => {
      const { bottomPadding = 0, topPadding = 0 } = listRef.current ?? {}
      const spacingPx =
        parseFloat(getComputedStyle(scrollEl).getPropertyValue('--spacing')) *
          16 || 4
      const topPaddingPx = topPadding * spacingPx
      const scrollRect = isDocScroll
        ? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
        : scrollEl.getBoundingClientRect()
      const { top, bottom } = getBlockBounds()
      const visibleBottom = scrollRect.bottom - bottomPadding - EXTRA_PADDING

      if (align === 'start') {
        const targetTop = scrollRect.top + topPaddingPx + 16
        // Leave the block alone only when it's already aligned at the top or
        // entirely on screen
        const alreadyReadable =
          top >= targetTop - 1 &&
          (top <= targetTop + 1 || bottom <= visibleBottom)
        if (alreadyReadable) return
        scrollBy(top - targetTop)
        return
      }

      if (bottom <= visibleBottom) return

      const overflowAmount = bottom - visibleBottom + 16
      const maxScroll = Math.max(0, top - scrollRect.top - topPaddingPx - 16)
      const scrollAmount = Math.min(overflowAmount, maxScroll)
      if (scrollAmount > 0) scrollBy(scrollAmount)
    }

    const waitForSettle = () => {
      if (cancelled || layoutIsCurrent?.() === false) return cleanup()
      if (layoutIsCurrent && coordinator?.kind === 'layout') {
        rafId = requestAnimationFrame(waitForSettle)
        return
      }

      const scrollHeight = getScrollHeight()
      // A short page can keep the same scrollHeight while the block expands
      const { top, bottom } = getBlockBounds()
      const blockHeight = bottom - top
      const layoutUnchanged =
        scrollHeight === prevScrollHeight && blockHeight === prevBlockHeight
      stableFrames = layoutUnchanged ? stableFrames + 1 : 0
      prevScrollHeight = scrollHeight
      prevBlockHeight = blockHeight

      if (stableFrames >= 2 || ++frames >= 60) {
        reveal()
        cleanup()
      } else {
        rafId = requestAnimationFrame(waitForSettle)
      }
    }

    const cleanup = () => {
      if (finished) return
      finished = true
      cancelAnimationFrame(rafId)
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchmove', cancel)
      finishComposerReveal?.(scrolled)
    }

    window.addEventListener('wheel', cancel, { passive: true })
    window.addEventListener('touchmove', cancel, { passive: true })
    rafId = requestAnimationFrame(waitForSettle)

    return cleanup
  }, [
    active,
    align,
    behavior,
    blockRef,
    scrollRef,
    coordinator,
    getBlockBottom,
    revealComposerMessageId,
  ])
}
