
import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'motion/react'

import { Surface } from './surface'

interface PopupDialogRootProps {
  children: React.ReactNode
  className?: string
  show?: boolean
}

function PopupDialogRoot({
  children,
  className,
  show = true,
}: PopupDialogRootProps) {
  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 1, y: 10 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className={cn(
            'absolute inset-0 z-50 m-2 flex items-center justify-center p-2',
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PopupDialogContent({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <Surface
      className={cn(
        'flex size-fit flex-col items-center justify-center p-4 shadow-xl',
        className,
      )}
    >
      {children}
    </Surface>
  )
}

function PopupDialogHeader({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-1.5 flex flex-col items-center gap-1.5', className)}>
      {children}
    </div>
  )
}

function PopupDialogBody({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('text-muted-foreground text-center text-sm', className)}>
      {children}
    </div>
  )
}

function PopupDialogFooter({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mt-4 flex w-full justify-center', className)}>
      {children}
    </div>
  )
}

export const PopupDialog = Object.assign(PopupDialogRoot, {
  Content: PopupDialogContent,
  Header: PopupDialogHeader,
  Body: PopupDialogBody,
  Footer: PopupDialogFooter,
})
