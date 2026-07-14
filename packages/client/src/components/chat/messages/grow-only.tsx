import { createOptionalContext } from '@/hooks/context'
import { cn } from '@/lib/utils'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

type GrowOnlyValue = {
  /** Allow the wrapper to shrink, tracking the content down as it settles. */
  release: () => void
}

const [GrowOnlyContext, useGrowOnly] = createOptionalContext<GrowOnlyValue>()

export { useGrowOnly }

const SETTLE_STABLE_FRAMES = 2
const SETTLE_MAX_FRAMES = 40

/** A component that never shrinks in height unless `release` is called. */
export function GrowOnly({
  children,
  className,
  ...rest
}: React.ComponentPropsWithoutRef<'div'>) {
  const contentRef = useRef<HTMLDivElement>(null)
  const floorRef = useRef(0)
  const followingRef = useRef(false)
  const cancelRef = useRef<(() => void) | null>(null)
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined)

  const measure = () => contentRef.current?.getBoundingClientRect().height ?? 0

  const grow = useCallback((height: number) => {
    if (height > floorRef.current) {
      floorRef.current = height
      setMinHeight(height)
    }
  }, [])

  const release = useCallback(() => {
    followingRef.current = true
    cancelRef.current?.()

    let last = -1
    let stable = 0
    let frames = 0
    let raf = 0
    const tick = () => {
      const height = measure()
      setMinHeight(height)
      if (Math.abs(height - last) < 0.5) stable++
      else {
        stable = 0
        last = height
      }
      if (stable >= SETTLE_STABLE_FRAMES || ++frames >= SETTLE_MAX_FRAMES) {
        floorRef.current = height
        followingRef.current = false
        cancelRef.current = null
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    cancelRef.current = () => cancelAnimationFrame(raf)
  }, [])

  useLayoutEffect(() => {
    grow(measure())
  }, [grow])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    let lastWidth = el.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      if (followingRef.current) return
      const rect = el.getBoundingClientRect()
      const widthChanged = Math.abs(rect.width - lastWidth) > 0.5
      lastWidth = rect.width
      if (widthChanged) {
        floorRef.current = rect.height
        setMinHeight(rect.height)
      } else {
        grow(rect.height)
      }
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelRef.current?.()
    }
  }, [grow])

  const value = useMemo(() => ({ release }), [release])

  return (
    <GrowOnlyContext.Provider value={value}>
      <div className={cn('w-full', className)} style={{ minHeight }} {...rest}>
        <div ref={contentRef} className="w-full">
          {children}
        </div>
      </div>
    </GrowOnlyContext.Provider>
  )
}
