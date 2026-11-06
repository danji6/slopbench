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
  const [readyView, setReadyView] = useState({
    viewKey,
    children,
    animateEnter: false,
  })
  const loading = viewKey === null
  const viewChanged =
    viewKey !== readyView.viewKey || children !== readyView.children
  if (!loading && viewChanged) {
    setReadyView({
      viewKey,
      children,
      animateEnter: readyView.animateEnter || viewKey !== readyView.viewKey,
    })
  }

  return (
    <div aria-busy={loading || undefined} inert={loading}>
      <AnimatePresence mode="wait">
        {readyView.viewKey === null ? (
          <div
            key="loading"
            className="min-h-32"
            aria-label="Loading welcome"
          />
        ) : (
          <WelcomeTransitionContent
            key={readyView.viewKey}
            animateEnter={readyView.animateEnter}
          >
            {readyView.children}
          </WelcomeTransitionContent>
        )}
      </AnimatePresence>
    </div>
  )
}

type WelcomeTransitionContentProps = {
  children: ReactNode
  animateEnter: boolean
}

function WelcomeTransitionContent({
  children,
  animateEnter,
}: WelcomeTransitionContentProps) {
  const present = useIsPresent()
  const reducedMotion = useReducedMotion()

  return (
    <motion.div
      inert={!present}
      initial={{ opacity: animateEnter ? 0 : 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.16, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  )
}
