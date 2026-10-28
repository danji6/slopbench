import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import { getNavPaddingPx } from '@/hooks/nav-padding'
import {
  type WindowScrollAnchor,
  captureWindowScrollAnchor,
  resolveWindowScrollAnchor,
  scrollAnchorElement,
} from '@/lib/chat/window-scroll-anchor'
import { scrollDebug } from '@/lib/scroll-debug'
import { trackUntilSettled } from '@/lib/scroll-settle'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

/** Compensates page layout changes before paint, including virtualizer measurements. */
function watchLayout(root: HTMLElement, compensate: () => number | null) {
  let raf = 0
  const tick = () => {
    compensate()
    raf = requestAnimationFrame(tick)
  }
  const resize = new ResizeObserver(() => compensate())
  resize.observe(root)
  const mutations = new MutationObserver(() => compensate())
  mutations.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
  })
  raf = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(raf)
    resize.disconnect()
    mutations.disconnect()
  }
}

/** Holds the same visible content throughout a bounded pagination operation. */
export function useWindowPosition({
  scroller,
  virtuaRef,
  rowsRef,
  docScrollRef,
  topPadding,
}: ScrollDeps) {
  const { coordinator, setShiftInProgress } = scroller
  const anchorRef = useRef<WindowScrollAnchor | null>(null)
  const currentRef = useRef<() => boolean>(() => false)
  const watchRef = useRef<(() => void) | null>(null)
  const settleRef = useRef<(() => void) | null>(null)
  const pageShiftRef = useRef(0)
  const slidePendingRef = useRef(false)
  const pendingPageRef = useRef<1 | -1 | null>(null)
  const [direction, setDirection] = useState<'older' | 'newer' | null>(null)

  const stop = useCallback(() => {
    watchRef.current?.()
    settleRef.current?.()
    watchRef.current = settleRef.current = null
    anchorRef.current = null
    slidePendingRef.current = false
    pendingPageRef.current = null
  }, [])

  const cancel = useCallback(() => {
    stop()
    setDirection(null)
  }, [stop])

  const compensate = useCallback((): number | null => {
    const anchors = anchorRef.current
    if (!anchors) return 0
    if (!currentRef.current()) return 0

    const retained = resolveWindowScrollAnchor(anchors, rowsRef.current)
    const index = retained?.index ?? 0

    const row = rowsRef.current[index]
    if (!row) return null

    const top = retained
      ? retained.top - pageShiftRef.current
      : getNavPaddingPx(topPadding)

    const item = document.querySelector<HTMLElement>(
      `[data-row-key="${CSS.escape(row.key)}"]`,
    )
    if (!item) {
      virtuaRef.current?.scrollToIndex(index, { align: 'start', offset: -top })
      return null
    }

    const node = retained ? scrollAnchorElement(item) : item
    const requestedY = window.scrollY + node.getBoundingClientRect().top - top
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight) // prettier-ignore
    const targetY = Math.max(0, Math.min(requestedY, maxY))
    const delta = targetY - window.scrollY
    if (Math.abs(delta) > 1) window.scrollTo({ top: targetY })

    return targetY - window.scrollY
  }, [rowsRef, topPadding, virtuaRef])

  const start = useCallback(
    (direction: 'older' | 'newer') => {
      stop()
      const container = docScrollRef.current
      if (!container) return
      currentRef.current = coordinator.checkpoint()
      anchorRef.current = captureWindowScrollAnchor(
        container,
        rowsRef.current,
        getNavPaddingPx(topPadding),
        window.innerHeight,
      )
      pageShiftRef.current = 0
      scrollDebug('position.start', () => ({
        direction,
        anchors: anchorRef.current?.map(({ row, top }) => ({
          key: row.key,
          kind: row.kind,
          top,
        })),
      }))
      slidePendingRef.current = true
      setDirection(direction)
      setShiftInProgress(true)
      watchRef.current = watchLayout(container, compensate)
    },
    [
      stop,
      docScrollRef,
      coordinator,
      rowsRef,
      topPadding,
      setShiftInProgress,
      compensate,
    ],
  )

  const finish = useCallback(() => {
    slidePendingRef.current = false
    const page = pendingPageRef.current
    pendingPageRef.current = null
    pageShiftRef.current = page ? window.innerHeight * 0.9 * page : 0
    compensate()
    settleRef.current?.()
    settleRef.current = trackUntilSettled(compensate, {
      onDone: () => {
        scrollDebug('position.done', () => {
          const retained = resolveWindowScrollAnchor(
            anchorRef.current ?? [],
            rowsRef.current,
          )
          return {
            rowKey: rowsRef.current[retained?.index ?? 0]?.key,
            fallback: !retained,
            pageShift: pageShiftRef.current,
          }
        })
        watchRef.current?.()
        watchRef.current = null
        anchorRef.current = null
        setDirection(null)
      },
    })
  }, [compensate, rowsRef])

  // React commits and virtualizer remeasurements both need compensation.
  useLayoutEffect(() => {
    compensate()
  })
  useEffect(() => stop, [stop])

  return {
    start,
    finish,
    cancel,
    slidePendingRef,
    pendingPageRef,
    isPositioning: direction !== null,
    isPositioningOlder: direction === 'older',
  }
}
