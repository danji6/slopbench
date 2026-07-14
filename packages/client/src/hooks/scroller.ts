import { ElementScrollTarget, WindowScrollTarget } from '@/lib/scroll-target'
import { type AutoScrollerOptions, Scroller } from '@/lib/scroller'
import { useCallback, useEffect, useRef } from 'react'

export type ScrollMode = 'element' | 'window'

export function useScroller(
  options?: AutoScrollerOptions & { mode?: ScrollMode },
) {
  const mode = options?.mode ?? 'element'
  const scrollerRef = useRef<Scroller | null>(null)
  const scrollRef = useRef<HTMLElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  if (scrollerRef.current === null) {
    scrollerRef.current = new Scroller(options)
  }

  const lockScroll = useCallback(() => {
    scrollerRef.current?.lockScroll()
  }, [])

  const unlockScroll = useCallback((shouldScroll?: boolean) => {
    scrollerRef.current?.unlockScroll(shouldScroll)
  }, [])

  const setShiftInProgress = useCallback((active: boolean) => {
    if (scrollerRef.current) {
      scrollerRef.current.shiftInProgress = active
    }
  }, [])

  const scrollToElementTop = useCallback(
    (element: HTMLElement, topPadding?: number) => {
      scrollerRef.current?.scrollToElementTop(element, topPadding)
    },
    [],
  )

  const scrollToBottom = useCallback((immediate?: boolean) => {
    scrollerRef.current?.scrollToBottom(immediate)
  }, [])

  const holdPosition = useCallback(() => {
    scrollerRef.current?.holdPosition()
  }, [])

  const pauseFollow = useCallback((direction: 1 | -1) => {
    scrollerRef.current?.pauseFollow(direction)
  }, [])

  const scrollUntilCondition = useCallback((condition: () => boolean) => {
    scrollerRef.current?.scrollUntilCondition(condition)
  }, [])

  const setReady = useCallback((ready: boolean) => {
    scrollerRef.current?.setReady(ready)
  }, [])

  const setImmediate = useCallback((value: boolean) => {
    scrollerRef.current?.setImmediate(value)
  }, [])

  useEffect(() => {
    if (scrollerRef.current && options?.enabled !== undefined) {
      scrollerRef.current.enabled = options.enabled
    }
  }, [options?.enabled])

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.onSettle = options?.onSettle ?? null
    }
  }, [options?.onSettle])

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.onFollowRelease = options?.onFollowRelease ?? null
    }
  }, [options?.onFollowRelease])

  useEffect(() => {
    scrollerRef.current?.setBottomInset(options?.bottomInset ?? 0)
  }, [options?.bottomInset])

  useEffect(() => {
    const scroller = scrollerRef.current
    const scrollElement = scrollRef.current
    const sentinel = sentinelRef.current
    if (!scroller || !scrollElement || !sentinel) return

    const target =
      mode === 'window'
        ? new WindowScrollTarget()
        : new ElementScrollTarget(scrollElement)

    scroller.setElements(target, scrollElement, sentinel)

    return () => {
      scroller.dispose()
    }
  }, [mode])

  return {
    scrollRef,
    sentinelRef,
    lockScroll,
    unlockScroll,
    setShiftInProgress,
    setReady,
    setImmediate,
    scrollToElementTop,
    scrollToBottom,
    holdPosition,
    pauseFollow,
    scrollUntilCondition,
  }
}
