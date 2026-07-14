
import { cn } from '@/lib/utils'
import { CheckIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import { CopyButton } from '.'

export function Color({
  color,
  colorName,
  className,
  onClick,
}: {
  color: string
  colorName?: string
  className?: string
  onClick?: (color: string) => void
}) {
  const [isCopied, setCopied] = useState(false)

  return (
    <CopyButton
      tooltip={colorName ?? color}
      value={color}
      onChange={(isCopied) => {
        setCopied(isCopied)
        onClick?.(color)
      }}
      render={
        <div
          className={cn(
            'relative size-10 cursor-pointer rounded-full border transition-all hover:scale-105',
            className,
          )}
          style={{ backgroundColor: color }}
        >
          <AnimatePresence>
            {isCopied && (
              <motion.span
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="bg-m3-surface-container/90 text-m3-on-surface absolute inset-0 z-10 flex size-full items-center justify-center rounded-full"
              >
                <CheckIcon />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      }
    />
  )
}
