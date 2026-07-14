import { RippleButton, type RippleButtonProps } from '@/components/ui'
import { cn } from '@/lib/utils'
import { type HTMLMotionProps, motion } from 'motion/react'

export type ChatPillProps = HTMLMotionProps<'div'> & {
  bottom?: number
}

function ChatPillRoot({ className, bottom = 0, ...props }: ChatPillProps) {
  return (
    <motion.div
      initial={{ scale: 0.85, bottom: 0, opacity: 0 }}
      animate={{ scale: 1, bottom, opacity: 1 }}
      exit={{ scale: 0.85, bottom: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 38 }}
      className={cn(
        'supports-backdrop-filter:bg-m3-surface-container-low/80 border-border bg-m3-surface-container-low flex h-10 overflow-clip rounded-full border shadow-lg backdrop-blur-md supports-backdrop-filter:backdrop-blur-xl',
        className,
      )}
      {...props}
    />
  )
}

function ChatPillButton({ className, ...props }: RippleButtonProps) {
  return (
    <RippleButton
      variant="stealth"
      className={cn('h-full w-16 flex-1 rounded-none', className)}
      {...props}
    />
  )
}

function ChatPillSeparator() {
  return <div className="bg-border h-full w-px" />
}

export const ChatPill = Object.assign(ChatPillRoot, {
  Button: ChatPillButton,
  Separator: ChatPillSeparator,
})
