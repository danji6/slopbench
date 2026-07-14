
import { useScroll } from '@/hooks'
import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronUpIcon } from 'lucide-react'

import { RippleButton, type RippleButtonProps } from './ripple-button'

export function ScrollTopButton({
  className,
  ...props
}: { className?: string } & RippleButtonProps) {
  const scroll = useScroll()

  return (
    <AnimatePresence>
      {scroll > 100 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'tween', ease: 'easeInOut', duration: 0.3 }}
          className={cn(
            'hover:border-ring border-input bg-background/80 hover:ring-ring fixed bottom-4 left-1/2 z-40 flex h-10 w-50 max-w-full -translate-x-1/2 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-[box-shadow,border,background] hover:ring',
            className,
          )}
        >
          <RippleButton
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            variant="input"
            className="hover:text-foreground m-0 h-full w-full border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:ring-0"
            {...props}
          >
            <ChevronUpIcon className="size-8" strokeWidth={1} />
          </RippleButton>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
