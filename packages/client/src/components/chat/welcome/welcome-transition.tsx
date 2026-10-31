import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react'
import { type ReactNode, useState } from 'react'

type WelcomeTransitionProps = {
  viewKey: string | null
  children: ReactNode
}

/** Keeps the last ready view visible until its replacement can fade in. */
export function WelcomeTransition({
  viewKey,
  children,
}: WelcomeTransitionProps) {
  const [readyView, setReadyView] = useState({ viewKey, children })
  const loading = viewKey === null
  const viewChanged =
    viewKey !== readyView.viewKey || children !== readyView.children
  if (!loading && viewChanged) setReadyView({ viewKey, children })

  return (
    <div aria-busy={loading || undefined} inert={loading}>
      <AnimatePresence initial={false} mode="wait">
        {readyView.viewKey === null ? (
          <div
            key="loading"
            className="min-h-32"
            aria-label="Loading welcome"
          />
        ) : (
          <WelcomeTransitionContent key={readyView.viewKey}>
            {readyView.children}
          </WelcomeTransitionContent>
        )}
      </AnimatePresence>
    </div>
  )
}

function WelcomeTransitionContent({ children }: { children: ReactNode }) {
  const present = useIsPresent()
  const reducedMotion = useReducedMotion()

  return (
    <motion.div
      inert={!present}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.16, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  )
}
