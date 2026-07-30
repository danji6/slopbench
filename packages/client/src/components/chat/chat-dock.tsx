import { cn } from '@/lib/utils'
import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Extra travel for shadows and blur to clear the edge too. */
const HIDE_OVERSHOOT = 24

/** How far the dock has to travel to fully slide out. */
function useHideDistance(ref: React.RefObject<HTMLElement | null>) {
  const [distance, setDistance] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    const stack = el?.offsetParent
    if (!el || !(stack instanceof HTMLElement)) return

    const measure = () => setDistance(stack.clientHeight - el.offsetTop)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observer.observe(stack)

    return () => observer.disconnect()
  }, [ref])

  return distance
}

export type ChatDockProps = {
  width: string
  alert?: React.ReactNode
  onAlertHeightChange?: (height: number) => void
  hidden?: boolean
  inert?: boolean
  children: React.ReactNode
}

export function ChatDock({
  width,
  alert,
  onAlertHeightChange,
  hidden = false,
  inert = false,
  children,
}: ChatDockProps) {
  const dockRef = useRef<HTMLDivElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const hideDistance = useHideDistance(dockRef)

  useEffect(() => {
    const el = alertRef.current
    if (!el || !onAlertHeightChange) return
    const observer = new ResizeObserver(([entry]) => {
      onAlertHeightChange(
        entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height,
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [onAlertHeightChange])

  return (
    <motion.div
      ref={dockRef}
      animate={{ y: hidden ? hideDistance + HIDE_OVERSHOOT : 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 38 }}
      className="relative"
      style={{ width }}
    >
      <motion.div
        ref={alertRef}
        className={cn(
          'pointer-events-auto absolute right-0 bottom-full left-0 mx-auto flex flex-col items-center',
          hidden && 'pointer-events-none',
        )}
        style={{ width: `calc(${width} - var(--spacing)*8)` }}
        animate={{ opacity: hidden ? 0 : 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 38 }}
      >
        {alert}
      </motion.div>
      <div
        // Click-through. Whatever needs interactivity must opt in.
        className="pointer-events-none relative mx-auto w-full"
        inert={inert}
      >
        {children}
      </div>
    </motion.div>
  )
}
