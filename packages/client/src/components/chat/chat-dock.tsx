import { cn } from '@/lib/utils'
import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'

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
  const alertRef = useRef<HTMLDivElement>(null)

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
      animate={hidden ? { y: '115%' } : { y: 0 }}
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
        className={cn(
          'pointer-events-auto relative mx-auto w-full',
          (hidden || inert) && 'pointer-events-none',
        )}
        inert={inert}
      >
        {children}
      </div>
    </motion.div>
  )
}
