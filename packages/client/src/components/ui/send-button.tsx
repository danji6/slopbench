
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'

import { RippleButton, type RippleButtonProps } from './ripple-button'

export type SendButtonProps = Omit<RippleButtonProps, 'children'> & {
  isStop?: boolean
}

const arrowPath = 'M 5 12 L 12 5 L 19 12 L 12 5 L 5 12 M 12 19 L 12 5'
const squarePath = 'M 6 6 L 18 6 L 18 18 L 6 18 L 6 6 M 12 12 L 12 12'

const transition = {
  type: 'tween',
  duration: 0.2,
} as const

export function SendButton({ isStop, className, ...props }: SendButtonProps) {
  const borderRadius = isStop ? '12px' : '20px'

  return (
    <RippleButton
      style={{ borderRadius }}
      animate={{ borderRadius }}
      transition={transition}
      className={cn(
        'rounded-[unset] px-[unset]',
        isStop ? 'transition-none' : 'transition-colors',
        className,
      )}
      {...props}
    >
      <motion.svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="flex items-center justify-center overflow-visible"
        layoutId="send-button-icon"
      >
        <motion.path
          initial={false}
          animate={{ d: isStop ? squarePath : arrowPath }}
          transition={transition}
          style={{ fill: 'currentColor' }}
        />
      </motion.svg>
    </RippleButton>
  )
}
