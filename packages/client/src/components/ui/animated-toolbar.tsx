import { cn } from '@/lib/utils'
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react'
import type { ComponentProps, ReactNode } from 'react'

function AnimatedToolbarRoot({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="animated-toolbar"
      className={cn('flex items-center', className)}
      {...props}
    />
  )
}

type AnimatedToolbarItemProps = {
  visible: boolean
  children: ReactNode
}

/** Animates an action's space without leaving exiting controls interactive. */
function AnimatedToolbarItem({ visible, children }: AnimatedToolbarItemProps) {
  return (
    <AnimatePresence initial={false}>
      {visible && <AnimatedToolbarContent>{children}</AnimatedToolbarContent>}
    </AnimatePresence>
  )
}

function AnimatedToolbarContent({ children }: { children: ReactNode }) {
  const present = useIsPresent()
  const reducedMotion = useReducedMotion()

  return (
    <motion.div
      data-slot="animated-toolbar-item"
      className="flex shrink-0 overflow-hidden"
      inert={!present}
      aria-hidden={!present || undefined}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 'auto', opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  )
}

export const AnimatedToolbar = Object.assign(AnimatedToolbarRoot, {
  Item: AnimatedToolbarItem,
})
