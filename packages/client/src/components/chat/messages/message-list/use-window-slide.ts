import { getNavPaddingPx } from '@/hooks/nav-padding'
import { trackUntilSettled } from '@/lib/scroll-settle'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import type { ScrollDeps } from './deps'

type WindowSlideOptions = {
  extendOlder: () => boolean
  extendNewer: () => boolean
  isSliding: boolean
}

/**
 * Preserves the visible scroll position across a window slide (loading an older
 * or newer page). Captures the first still visible message, then converges back
 * onto it once the slide settles.
 */
export function useWindowSlide(
  deps: ScrollDeps,
  { extendOlder, extendNewer, isSliding }: WindowSlideOptions,
) {
  const { scroller, virtuaRef, rowsRef, metaRef, docScrollRef, topPadding } =
    deps
  const { setShiftInProgress } = scroller

  // Tracks the position of a message across a window slide so it can be restored
  const slideAnchorRef = useRef<{ id: string; top: number } | null>(null)
  const slidePendingRef = useRef(false)
  // A pending Page Up/Down continuation that slid the window
  const pendingPageRef = useRef<1 | -1 | null>(null)
  const slideRestoreRef = useRef<(() => void) | null>(null)

  // Capture the first message still visible below the nav padding
  const captureSlideAnchor = useCallback(() => {
    const container = docScrollRef.current
    if (!container) return null
    const topPaddingPx = getNavPaddingPx(topPadding)
    const els = container.querySelectorAll<HTMLElement>('[data-message-id]')
    for (const el of els) {
      const rect = el.getBoundingClientRect()
      if (rect.bottom > topPaddingPx) {
        const id = el.dataset.messageId
        if (id) return { id, top: rect.top }
      }
    }
    return null
  }, [docScrollRef, topPadding])

  const loadOlder = useCallback(() => {
    const m = metaRef.current
    if (!m.canLoadOlder || m.isLoadingOlder) return
    const anchor = captureSlideAnchor()
    setShiftInProgress(true)
    if (extendOlder() && anchor) {
      slideAnchorRef.current = anchor
      slidePendingRef.current = true
    }
  }, [extendOlder, setShiftInProgress, captureSlideAnchor, metaRef])

  const loadNewer = useCallback(() => {
    const m = metaRef.current
    if (!m.canLoadNewer || m.isLoadingNewer) return
    const anchor = captureSlideAnchor()
    setShiftInProgress(true)
    if (extendNewer() && anchor) {
      slideAnchorRef.current = anchor
      slidePendingRef.current = true
    }
  }, [extendNewer, setShiftInProgress, captureSlideAnchor, metaRef])

  // Restore the anchor to preserve the scroll position
  const restoreSlideAnchor = useCallback(() => {
    const anchor = slideAnchorRef.current
    slideAnchorRef.current = null
    if (!anchor) return

    const topPaddingPx = getNavPaddingPx(topPadding)
    const page = pendingPageRef.current
    pendingPageRef.current = null
    const pageShift = page ? window.innerHeight * 0.9 * page : 0
    const targetTop = Math.max(topPaddingPx, anchor.top) - pageShift

    slideRestoreRef.current?.()
    // Converge on the anchor's real position
    slideRestoreRef.current = trackUntilSettled(() => {
      const index = rowsRef.current.findIndex(
        (row) => row.messageId === anchor.id,
      )
      if (index < 0) return null

      const el = document.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(anchor.id)}"]`,
      )
      // Bring it closer if it's not mounted yet
      if (!el) {
        virtuaRef.current?.scrollToIndex(index, {
          align: 'start',
          offset: -targetTop,
        })
        return null
      }

      const delta = el.getBoundingClientRect().top - targetTop
      if (Math.abs(delta) > 1) window.scrollBy({ top: delta })
      return delta
    })
  }, [topPadding, rowsRef, virtuaRef])
  useEffect(() => () => slideRestoreRef.current?.(), [])

  const prevSlidingRef = useRef(isSliding)
  useLayoutEffect(() => {
    const wasSliding = prevSlidingRef.current
    prevSlidingRef.current = isSliding
    if (wasSliding && !isSliding && slidePendingRef.current) {
      slidePendingRef.current = false
      restoreSlideAnchor()
    }
  }, [isSliding, restoreSlideAnchor])

  return { loadOlder, loadNewer, slidePendingRef, pendingPageRef }
}

export type WindowSlide = ReturnType<typeof useWindowSlide>
