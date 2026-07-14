
import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2Icon } from 'lucide-react'
import { useState } from 'react'

// For this to work, the parent element must have relative position
export function Overlay({
  children,
  show = true,
  className,
  onClick,
  ...props
}: {
  children?: React.ReactNode
  show?: boolean
  className?: string
  onClick?: () => void
} & React.ComponentProps<typeof motion.span>) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96, pointerEvents: 'none' }}
          transition={{ type: 'tween', duration: 0.2 }}
          data-slot="overlay"
          onClick={(e) => {
            e.stopPropagation()
            if (e.target !== e.currentTarget) return
            onClick?.()
          }}
          className={cn(
            // z-40 comes before Dialog
            'bg-background/90 absolute inset-0 z-40 flex cursor-default items-center justify-center backdrop-blur-md',
            className,
          )}
          {...props}
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

export function HoverOverlay({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <span
      role="none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      className="absolute inset-0"
    >
      <Overlay show={isHovered} className={className}>
        {children}
      </Overlay>
    </span>
  )
}

export function LoadingOverlay({
  show = true,
  className,
}: {
  show?: boolean
  className?: string
}) {
  return (
    <Overlay show={show} className={className}>
      <Loader2Icon className={'text-primary size-10 animate-spin'} />
    </Overlay>
  )
}

export function GhostOverlay({
  show = true,
  children,
  className,
  ...props
}: {
  show?: boolean
  children: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      data-show={show}
      className={cn(
        'bg-background/90 absolute inset-0 z-40 flex cursor-default items-center justify-center backdrop-blur-md transition-opacity data-[show=false]:invisible data-[show=false]:opacity-0',
        className,
      )}
    >
      {children}
    </span>
  )
}
