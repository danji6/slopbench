import { PulsingDots } from '@/components/ui'
import { cn } from '@/lib/utils'
import { AnimatePresence, type HTMLMotionProps, motion } from 'motion/react'

export type WaitingIndicatorProps = HTMLMotionProps<'div'> & {
  visible: boolean
}

export function WaitingIndicator(props: WaitingIndicatorProps) {
  const { visible, className, ...rest } = props

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          data-slot="waiting-indicator"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={cn(
            'absolute bottom-0 left-0 flex w-full min-w-0 items-start px-4 py-5',
            className,
          )}
          {...rest}
        >
          <PulsingDots className="gap-2" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
