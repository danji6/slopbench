import { trackHeightSettle } from '@/lib/scroll-settle'
import { useEffect, useLayoutEffect, useRef } from 'react'

import type { ScrollDeps } from '../deps'

type InitialPositionOptions = {
  isLoading: boolean
  rowCount: number
  restoreScroll(): boolean
  markRevealed(): void
}

/** Restores a saved anchor or settles at the tail before revealing the list. */
export function useInitialPosition(
  { scroller, virtuaRef }: ScrollDeps,
  { isLoading, rowCount, restoreScroll, markRevealed }: InitialPositionOptions,
) {
  const { setReady, setImmediate, scrollToBottom, coordinator } = scroller
  const hasInitiallyScrolledRef = useRef(false)
  const initialSettleRef = useRef<(() => void) | null>(null)
  // Scroll to the bottom once the session is fully loaded
  useLayoutEffect(() => {
    if (isLoading) return
    setReady(true)
    if (!hasInitiallyScrolledRef.current && rowCount > 0) {
      hasInitiallyScrolledRef.current = true
      // Attempt scroll restore
      if (restoreScroll()) return
      const operation = coordinator.begin('restore')
      if (!operation) {
        markRevealed()
        return
      }
      operation.onCancel(() => {
        initialSettleRef.current?.()
        setImmediate(false)
        markRevealed()
      })
      // Snap immediately while the freshly mounted list re-measures its rows
      setImmediate(true)
      virtuaRef.current?.scrollToIndex(rowCount - 1, { align: 'end' })
      initialSettleRef.current?.()
      initialSettleRef.current = trackHeightSettle(
        () => {
          if (operation.isCurrent()) scrollToBottom(true)
        },
        document.documentElement,
        () => {
          if (!operation.isCurrent()) return
          operation.finish()
          setImmediate(false)
          // Reveal the list only after the height settles
          markRevealed()
        },
      )
    }
  }, [
    isLoading,
    setReady,
    rowCount,
    scrollToBottom,
    setImmediate,
    restoreScroll,
    markRevealed,
    coordinator,
    virtuaRef,
  ])

  useEffect(() => () => initialSettleRef.current?.(), [])
}
