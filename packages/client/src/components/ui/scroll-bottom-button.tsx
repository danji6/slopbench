
import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDownIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { RippleButton, type RippleButtonProps } from './ripple-button'

const BOTTOM_THRESHOLD = 10

interface ScrollBottomButtonProps extends RippleButtonProps {
  targetRef: React.RefObject<HTMLElement | null>
  onBottomReached?: () => void
}

export function ScrollBottomButton({
  targetRef,
  className,
  onBottomReached,
  ...props
}: ScrollBottomButtonProps) {
  const [isAtBottom, setIsAtBottom] = useState(true)

  useEffect(() => {
    const el = targetRef.current
    if (!el) return

    const check = () => {
      const isBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_THRESHOLD
      setIsAtBottom(isBottom)
      if (isBottom && onBottomReached) {
        onBottomReached()
      }
    }

    check()
    el.addEventListener('scroll', check, { passive: true })

    const ro = new ResizeObserver(check)
    ro.observe(el)

    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [targetRef, onBottomReached])

  return (
    <AnimatePresence>
      {!isAtBottom && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'tween', ease: 'easeInOut', duration: 0.3 }}
          className="absolute bottom-4 left-1/2 z-40 -translate-x-1/2"
        >
          <RippleButton
            variant="input"
            className={cn(
              'bg-background/80 m-0 flex h-10 w-10 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-[box-shadow,border,background]',
              className,
            )}
            {...props}
          >
            <ChevronDownIcon className="size-8" strokeWidth={1} />
          </RippleButton>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
