import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'motion/react'

type InsetDrawerSide = 'left' | 'right'

export type InsetDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  side?: InsetDrawerSide
  className?: string
  backdropClassName?: string
  children: React.ReactNode
}

export function InsetDrawer({
  open,
  onOpenChange,
  side = 'left',
  className,
  backdropClassName,
  children,
}: InsetDrawerProps) {
  const hidden = side === 'left' ? '-100%' : '100%'

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            data-slot="inset-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => onOpenChange(false)}
            className={cn(
              'absolute inset-0 z-40 bg-black/30 supports-backdrop-filter:backdrop-blur-xs',
              backdropClassName,
            )}
          />
          <motion.div
            data-slot="inset-drawer-content"
            initial={{ x: hidden }}
            animate={{ x: 0 }}
            exit={{ x: hidden }}
            transition={{ type: 'tween', ease: 'easeOut', duration: 0.2 }}
            className={cn(
              'bg-popover absolute inset-y-0 z-50 flex w-64 max-w-xs flex-col shadow-xl',
              side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
              className,
            )}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
