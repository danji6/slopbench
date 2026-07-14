import { safeWindow } from '@/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'

type ScrollerOptions = {
  container: Window | HTMLElement | undefined | null
  skip?: boolean
  action: (context: {
    frames: number
    framesSinceHeightChange: number
    scrollHeight: number
  }) => boolean
  onFinished?: () => void
}

type AtBottomStickyOptions = {
  unstickDistance?: number
}

const scrollCancelEvents = [
  'mousedown',
  'wheel',
  'touchmove',
  'keydown',
] as const

const NEAR_BOTTOM_THRESHOLD = 20
const MIN_SCROLL_DELTA = 5
const INITIAL_BOTTOM_DISTANCE = 0

export function useScroll() {
  const [scroll, setScroll] = useState(0)

  useEffect(() => {
    function handleScroll() {
      setScroll(window.scrollY)
    }

    handleScroll()

    window.addEventListener('scroll', handleScroll)

    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  return scroll
}

export function useScrollDown() {
  const [isScrollingDown, setScrollingDown] = useState(true)
  const lastScrollTopRef = useRef(0)

  const onScroll = useCallback((e: Event) => {
    const el = e.currentTarget as HTMLElement
    const scrollTop = el.scrollTop
    const isNearBottom =
      el.scrollHeight - scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD

    if (isNearBottom) {
      setScrollingDown(true)
      lastScrollTopRef.current = scrollTop
      return
    }

    const delta = scrollTop - lastScrollTopRef.current
    if (Math.abs(delta) < MIN_SCROLL_DELTA) return

    setScrollingDown(delta > 0)
    lastScrollTopRef.current = scrollTop
  }, [])

  return { isScrollingDown, onScroll }
}

export function useAtBottom(onReachBottom?: () => void) {
  const [isAtBottom, setIsAtBottom] = useState(true)
  const onReachBottomRef = useRef(onReachBottom)
  useEffect(() => {
    onReachBottomRef.current = onReachBottom
  }, [onReachBottom])

  const onScroll = useCallback((e?: Event) => {
    const { distFromBottom } = getScrollMetrics(e)
    const atBottom = distFromBottom < NEAR_BOTTOM_THRESHOLD
    setIsAtBottom((prev) => {
      if (atBottom && !prev) onReachBottomRef.current?.()
      return atBottom
    })
  }, [])

  return { isAtBottom, onScroll }
}

export function useAtBottomSticky(
  onReachBottom?: () => void,
  options: AtBottomStickyOptions = {},
) {
  const unstickDistance = options.unstickDistance ?? NEAR_BOTTOM_THRESHOLD
  const [isStuck, setIsStuck] = useState(true)
  const [distanceFromBottom, setDistanceFromBottom] = useState(
    INITIAL_BOTTOM_DISTANCE,
  )
  const onReachBottomRef = useRef(onReachBottom)
  const lastScrollTopRef = useRef(0)
  const releasedRef = useRef(false)

  useEffect(() => {
    onReachBottomRef.current = onReachBottom
  }, [onReachBottom])

  const onScroll = useCallback(
    (e?: Event) => {
      const { scrollTop, distFromBottom, contentFits } = getScrollMetrics(e)
      setDistanceFromBottom(distFromBottom)
      const movedUp = scrollTop < lastScrollTopRef.current
      lastScrollTopRef.current = scrollTop
      const atBottom = distFromBottom < NEAR_BOTTOM_THRESHOLD

      if (releasedRef.current) {
        // Stay released when there's nothing to scroll
        if (atBottom && !contentFits) return
        releasedRef.current = false
      }

      setIsStuck((prev) => {
        if (atBottom) {
          if (!prev) onReachBottomRef.current?.()
          return true
        }
        return movedUp && distFromBottom >= unstickDistance ? false : prev
      })
    },
    [unstickDistance],
  )

  const release = useCallback(() => {
    releasedRef.current = true
    setIsStuck(false)
  }, [])

  return { isAtBottom: isStuck, distanceFromBottom, onScroll, release }
}

export function useScrollToId(id?: string, smooth = false) {
  useScroller({
    container: safeWindow,
    skip: !id,
    action: ({ framesSinceHeightChange }) => {
      if (!id) return true
      const element = document.getElementById(id)
      if (element) {
        element.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
        // Stop if stable for a bit
        return framesSinceHeightChange > 60
      }
      return false
    },
  })
}

function useScroller({ container, skip, action, onFinished }: ScrollerOptions) {
  const actionRef = useRef(action)
  useEffect(() => {
    actionRef.current = action
  }, [action])

  const onFinishedRef = useRef(onFinished)
  useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])

  useEffect(() => {
    if (skip || !container) return

    let frames = 0
    let lastScrollHeight = getScrollHeight(container)
    let framesSinceHeightChange = 0
    let raf: number
    let isCancelled = false

    const cancel = () => {
      isCancelled = true
    }

    const onInteraction = () => cancel()
    scrollCancelEvents.forEach((e) => {
      container.addEventListener(e, onInteraction, {
        passive: true,
        capture: true,
      })
    })

    function loop() {
      if (isCancelled || !container) {
        cleanup()
        return
      }

      const h = getScrollHeight(container)
      if (h !== lastScrollHeight) {
        lastScrollHeight = h
        framesSinceHeightChange = 0
      } else {
        framesSinceHeightChange++
      }

      const shouldStop = actionRef.current({
        frames,
        scrollHeight: h,
        framesSinceHeightChange,
      })

      if (shouldStop) {
        cleanup()
        if (onFinishedRef.current) onFinishedRef.current()
        return
      }

      if (frames++ < 600 && framesSinceHeightChange < 120) {
        raf = requestAnimationFrame(loop)
      } else {
        cleanup()
        if (onFinishedRef.current) onFinishedRef.current()
      }
    }

    raf = requestAnimationFrame(loop)

    function cleanup() {
      cancelAnimationFrame(raf)
      scrollCancelEvents.forEach((e) => {
        container?.removeEventListener(e, onInteraction, { capture: true })
      })
    }

    return () => {
      isCancelled = true
      cleanup()
    }
  }, [container, skip])
}

function getScrollHeight(container: HTMLElement | Window) {
  if (container instanceof Window) {
    return document.documentElement.scrollHeight
  }
  return container.scrollHeight
}

function getScrollMetrics(e?: Event) {
  const target = e?.currentTarget
  if (target instanceof HTMLElement) {
    return {
      scrollTop: target.scrollTop,
      distFromBottom:
        target.scrollHeight - target.scrollTop - target.clientHeight,
      contentFits: target.scrollHeight <= target.clientHeight,
    }
  }
  const scrollHeight = document.documentElement.scrollHeight
  return {
    scrollTop: window.scrollY,
    distFromBottom: scrollHeight - window.scrollY - window.innerHeight,
    contentFits: scrollHeight <= window.innerHeight,
  }
}
