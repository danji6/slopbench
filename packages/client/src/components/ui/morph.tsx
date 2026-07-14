import { AnimatePresence, motion } from 'motion/react'

export function Morph({
  morphKey,
  children,
}: {
  morphKey: string
  children: React.ReactNode
}) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        className="inset-0"
        key={morphKey}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  )
}
