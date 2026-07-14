import { useCallback, useEffect, useRef } from 'react'

import type { ScrollDeps } from './deps'
import type { WindowSlide } from './use-window-slide'

/** Page Up/Down scrolling that pulls in the next window at the edges. */
export function usePageScroll(deps: ScrollDeps, slide: WindowSlide) {
  const { scroller, metaRef, docScrollRef } = deps
  const { holdPosition, pauseFollow } = scroller
  const { loadOlder, loadNewer, slidePendingRef, pendingPageRef } = slide

  const growScrollRef = useRef(0)
  // Continue scrolling compensating for height recalculations
  const continueScrollAfterGrow = useCallback((direction: 1 | -1) => {
    cancelAnimationFrame(growScrollRef.current)
    const startHeight = document.documentElement.scrollHeight
    let frames = 0
    const tick = () => {
      if (document.documentElement.scrollHeight !== startHeight) {
        window.scrollBy({ top: window.innerHeight * 0.9 * direction })
        return
      }
      if (++frames > 40) return
      growScrollRef.current = requestAnimationFrame(tick)
    }
    growScrollRef.current = requestAnimationFrame(tick)
  }, [])
  useEffect(() => () => cancelAnimationFrame(growScrollRef.current), [])

  const scrollByPage = useCallback(
    (direction: 1 | -1) => {
      const doc = docScrollRef.current
      if (!doc) return

      const max = Math.max(0, doc.scrollHeight - window.innerHeight)
      const atTop = direction === -1 && window.scrollY <= 1
      const atBottom = direction === 1 && window.scrollY >= max - 1
      const m = metaRef.current

      // At a window edge, pull in the next page and keep scrolling into it
      if (atTop && m.canLoadOlder && !m.isLoadingOlder) {
        holdPosition()
        loadOlder()
        if (slidePendingRef.current) pendingPageRef.current = direction
        else continueScrollAfterGrow(direction)
        return
      }
      if (atBottom && m.canLoadNewer && !m.isLoadingNewer) {
        holdPosition()
        loadNewer()
        if (slidePendingRef.current) pendingPageRef.current = direction
        else continueScrollAfterGrow(direction)
        return
      }

      pauseFollow(direction)
      window.scrollBy({ top: window.innerHeight * 0.9 * direction })
    },
    [
      pauseFollow,
      holdPosition,
      loadOlder,
      loadNewer,
      continueScrollAfterGrow,
      metaRef,
      docScrollRef,
      slidePendingRef,
      pendingPageRef,
    ],
  )

  return { scrollByPage }
}
