
import { cn } from '@/lib/utils'
import { motion } from 'motion/react'
import type * as React from 'react'

import { RippleButton } from './ripple-button'
import { Spinner } from './spinner'

export function LoadingButton({
  loading,
  children,
  disabled,
  className,
  ...props
}: { loading?: boolean } & React.ComponentProps<typeof RippleButton>) {
  return (
    <RippleButton
      disabled={disabled || loading}
      className={cn(
        'disabled:text-m3-on-tertiary disabled:bg-m3-tertiary gap-0! disabled:opacity-100',
        className,
      )}
      {...props}
    >
      <motion.span
        variants={{
          hidden: { width: 0, opacity: 0 },
          visible: {
            width: 'fit-content',
            opacity: 1,
            marginRight: 'calc(var(--spacing)*2)',
          },
        }}
        initial="hidden"
        animate={loading ? 'visible' : 'hidden'}
        transition={{
          duration: 0.2,
          ease: 'easeOut',
        }}
        className="overflow-hidden"
      >
        <Spinner
          variant="circle"
          className="size-5 shrink-0 animate-spin text-current"
        />
      </motion.span>
      {children}
    </RippleButton>
  )
}
