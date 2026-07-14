
import { cn } from '@/lib/utils'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'

export function Sticky({
  onSticky,
  position = 'top',
  className,
  stickyClassName,
  unstickyClassName,
  offset = 0,
  children,
}: {
  onSticky?: (isSticky: boolean) => void
  position?: 'top' | 'bottom'
  className?: string
  stickyClassName?: string
  unstickyClassName?: string
  offset?: number
  children: React.ReactElement
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [isSticky, setIsSticky] = useState(false)
  const prevStickyRef = useRef<boolean>(false)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        const stuck = !entry.isIntersecting
        if (stuck !== prevStickyRef.current) {
          prevStickyRef.current = stuck
          setIsSticky(stuck)
          onSticky?.(stuck)
        }
      },
      {
        root: null,
        threshold: 0,
        rootMargin:
          position === 'top'
            ? `${-offset}px 0px 0px 0px`
            : `0px 0px ${-offset}px 0px`,
      },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onSticky, offset, position])

  const isTop = position === 'top'

  return (
    <>
      {isTop && <div ref={sentinelRef} aria-hidden="true" className="h-0" />}
      <div
        data-slot="sticky"
        className={cn(
          'sticky z-40',
          isTop ? 'top-0' : 'bottom-0',
          isSticky
            ? cn('bg-background shadow-md', stickyClassName)
            : cn('bg-transparent', unstickyClassName),
          className,
        )}
      >
        {children}
      </div>
      {!isTop && <div ref={sentinelRef} aria-hidden="true" className="h-0" />}
    </>
  )
}
